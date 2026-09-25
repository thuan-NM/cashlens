import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CategoryDecisionReason,
  CategoryDecisionTrigger,
  ClassificationSource,
  Prisma,
  TransactionCategoryStatus,
  TransactionDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { LockedTransaction } from './classification.repository';
import { ClassificationRepository } from './classification.repository';
import {
  CreateClassificationRuleDto,
  UpdateClassificationRuleDto,
} from './dto/classification-rule.dto';

/** A classification rule with the category it targets (T052 query shape). */
export type ClassificationRule = {
  id: string;
  userId: string | null;
  categoryId: string | null;
  merchantPattern: string | null;
  descriptionPattern: string | null;
  bankName: string | null;
  direction: TransactionDirection | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  category: {
    id: string;
    userId: string | null;
    isSystem: boolean;
    status: TransactionCategoryStatus;
  } | null;
};

/** The transaction attributes rules are evaluated against (CLASS-001). */
export type ClassificationFacts = {
  userId: string;
  merchantName?: string | null;
  counterpartyName?: string | null;
  description?: string | null;
  bankName?: string | null;
  direction: TransactionDirection;
};

export type DecisionMode = 'AUTOMATIC' | 'EXPLICIT';

export type RuleScope = 'USER' | 'SYSTEM';
export type TieBreak = 'SCOPE' | 'PRIORITY' | 'CREATED_AT' | 'ID';

/** Why the winner won (CLASS-003): ids and codes only, never rule text. */
export type DecisionExplanation = {
  candidates: Array<{
    ruleId: string;
    scope: RuleScope;
    priority: number;
    createdAt: string;
    categoryId: string;
  }>;
  winnerRuleId: string | null;
  runnerUpRuleId: string | null;
  tieBreak: TieBreak | null;
  conflict: boolean;
};

export type Decision =
  | {
      outcome: 'PROTECTED';
      source: 'MANUAL';
      categoryId: string | null;
      ruleId: null;
      reason: null;
      explanation: null;
    }
  | {
      outcome: 'DECIDED';
      source: 'USER_RULE' | 'SYSTEM_RULE' | 'FALLBACK';
      categoryId: string | null;
      ruleId: string | null;
      reason: 'RULE_MATCHED' | 'NO_RULE_MATCHED';
      explanation: DecisionExplanation;
    };

/**
 * Text as rules compare it (documented matching, CLASS-001): Unicode
 * decomposed with diacritics removed (đ/Đ read as d), lower-case, runs of
 * whitespace collapsed, trimmed. Patterns are literal text, never regexes.
 */
export const normalizeForMatch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const criterion = (value: string | null) =>
  value === null ? '' : normalizeForMatch(value);

/** A rule needs at least one text criterion: merchant, description, or bank. */
export const hasTextCriterion = (
  rule: Pick<
    ClassificationRule,
    'merchantPattern' | 'descriptionPattern' | 'bankName'
  >,
) =>
  Boolean(
    criterion(rule.merchantPattern) ||
    criterion(rule.descriptionPattern) ||
    criterion(rule.bankName),
  );

/**
 * Whether a rule may decide for this owner (CLASS-001, data-model "MerchantRule
 * ownership"): active; a user rule of the owner or a system rule; targeting an
 * ACTIVE category that is a system category or, for a user rule, the owner's.
 */
const isEligible = (rule: ClassificationRule, userId: string) => {
  const category = rule.category;
  if (!rule.isActive || !category || rule.categoryId !== category.id) {
    return false;
  }
  if (category.status !== 'ACTIVE' || !hasTextCriterion(rule)) return false;
  const systemCategory = category.userId === null && category.isSystem;
  if (rule.userId === null) return systemCategory;
  return (
    rule.userId === userId && (systemCategory || category.userId === userId)
  );
};

const contains = (text: string | null | undefined, pattern: string) =>
  !pattern || (Boolean(text) && normalizeForMatch(text!).includes(pattern));

/** Every criterion that is set must hold (AND). */
const matches = (rule: ClassificationRule, facts: ClassificationFacts) => {
  const merchant = facts.merchantName?.trim()
    ? facts.merchantName
    : facts.counterpartyName;
  const bank = criterion(rule.bankName);
  return (
    contains(merchant, criterion(rule.merchantPattern)) &&
    contains(facts.description, criterion(rule.descriptionPattern)) &&
    (!bank ||
      (Boolean(facts.bankName) &&
        normalizeForMatch(facts.bankName!) === bank)) &&
    (rule.direction === null || rule.direction === facts.direction)
  );
};

const scopeOf = (rule: ClassificationRule): RuleScope =>
  rule.userId === null ? 'SYSTEM' : 'USER';

/**
 * Precedence (CLASS-002): user rules before system rules; then the highest
 * numeric priority; then the earliest creation time; then the smallest id,
 * compared by code unit so the result never depends on a database collation.
 */
const rank = (a: ClassificationRule, b: ClassificationRule) =>
  (scopeOf(a) === scopeOf(b) ? 0 : scopeOf(a) === 'USER' ? -1 : 1) ||
  b.priority - a.priority ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const tieBreakBetween = (
  winner: ClassificationRule,
  runnerUp: ClassificationRule,
): TieBreak =>
  scopeOf(winner) !== scopeOf(runnerUp)
    ? 'SCOPE'
    : winner.priority !== runnerUp.priority
      ? 'PRIORITY'
      : winner.createdAt.getTime() !== runnerUp.createdAt.getTime()
        ? 'CREATED_AT'
        : 'ID';

/**
 * The deterministic classification decision (CLASS-002–CLASS-004, CLASS-007).
 * Pure: the same facts and rules always give the same decision, in any input
 * order. An automatic run never overrides a MANUAL decision (TX-004); only an
 * explicit reclassification releases it (CLASS-006).
 */
export function decide(
  facts: ClassificationFacts,
  rules: ClassificationRule[],
  options: {
    mode: DecisionMode;
    current: { source: ClassificationSource; categoryId: string | null };
  },
): Decision {
  if (options.mode === 'AUTOMATIC' && options.current.source === 'MANUAL') {
    return {
      outcome: 'PROTECTED',
      source: 'MANUAL',
      categoryId: options.current.categoryId,
      ruleId: null,
      reason: null,
      explanation: null,
    };
  }
  const candidates = rules
    .filter((rule) => isEligible(rule, facts.userId) && matches(rule, facts))
    .sort(rank);
  const [winner, runnerUp] = candidates;
  const explanation: DecisionExplanation = {
    candidates: candidates.map((rule) => ({
      ruleId: rule.id,
      scope: scopeOf(rule),
      priority: rule.priority,
      createdAt: rule.createdAt.toISOString(),
      categoryId: rule.categoryId!,
    })),
    winnerRuleId: winner?.id ?? null,
    runnerUpRuleId: runnerUp?.id ?? null,
    tieBreak: winner && runnerUp ? tieBreakBetween(winner, runnerUp) : null,
    conflict: new Set(candidates.map((rule) => rule.categoryId)).size > 1,
  };
  if (!winner) {
    return {
      outcome: 'DECIDED',
      source: 'FALLBACK',
      categoryId: null,
      ruleId: null,
      reason: 'NO_RULE_MATCHED',
      explanation,
    };
  }
  return {
    outcome: 'DECIDED',
    source: scopeOf(winner) === 'USER' ? 'USER_RULE' : 'SYSTEM_RULE',
    categoryId: winner.categoryId,
    ruleId: winner.id,
    reason: 'RULE_MATCHED',
    explanation,
  };
}

/** Who made a category decision (CLASS-005). */
export type DecisionActor =
  | { type: 'USER'; userId: string }
  | { type: 'SYSTEM' };

/** A decision that sets the current classification (not PROTECTED). */
export type AppliedDecision = {
  source: 'MANUAL' | 'USER_RULE' | 'SYSTEM_RULE' | 'FALLBACK';
  categoryId: string | null;
  ruleId: string | null;
  reason: CategoryDecisionReason;
  explanation: DecisionExplanation | null;
};

/**
 * The five columns of the current decision, always written together so they
 * never disagree. `classificationConfidence` is 1 when a category was set by
 * the owner or a rule, and null for a clear or the fallback; the parser's own
 * `confidence` column is never touched.
 */
export const decisionColumns = (
  decision: Pick<AppliedDecision, 'source' | 'categoryId' | 'ruleId'>,
  at: Date,
) => ({
  categoryId: decision.categoryId,
  classificationSource: decision.source,
  classificationRuleId: decision.ruleId,
  classifiedAt: at,
  classificationConfidence: decision.categoryId ? 1 : null,
});

/** The owner's manual choice (TX-004): the category, or a clear. */
export const manualDecision = (categoryId: string | null): AppliedDecision => ({
  source: 'MANUAL',
  categoryId,
  ruleId: null,
  reason: categoryId ? 'MANUAL_SET' : 'MANUAL_CLEARED',
  explanation: null,
});

const factsOf = (row: LockedTransaction): ClassificationFacts => ({
  userId: row.userId,
  merchantName: row.merchantName,
  counterpartyName: row.counterpartyName,
  description: row.description,
  bankName: row.bankName,
  direction: row.direction,
});

type RuleRow = Awaited<
  ReturnType<ClassificationRepository['listRules']>
>[number];

/** A rule as its owner sees it; system rules are read-only and ownerless. */
export const toClassificationRuleResponse = (rule: RuleRow) => ({
  id: rule.id,
  scope: rule.userId === null ? ('SYSTEM' as const) : ('USER' as const),
  categoryId: rule.categoryId,
  merchantPattern: rule.merchantPattern,
  descriptionPattern: rule.descriptionPattern,
  bankName: rule.bankName,
  direction: rule.direction,
  priority: rule.priority,
  isActive: rule.isActive,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
});

const ruleNotFound = () =>
  new NotFoundException('Classification rule not found');

/**
 * Deterministic rule-based classification (CLASS-001–CLASS-007): automatic
 * decisions for new transactions, the automatic rerun of an existing one, the
 * append-only history, and the owner's rules. Nothing is learned or
 * generated: every decision is the documented rule ranking (CLASS-007).
 */
@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    private readonly repository: ClassificationRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The automatic decision for a transaction being created (manual create or
   * email import), read inside the caller's database transaction. Null when
   * the owner turned automatic classification off: the row stays UNKNOWN.
   */
  async decideNew(
    tx: Prisma.TransactionClient,
    facts: ClassificationFacts,
  ): Promise<AppliedDecision | null> {
    if (!(await this.repository.autoClassificationEnabled(facts.userId, tx))) {
      return null;
    }
    const decision = await this.decideHeld(tx, facts, {
      mode: 'AUTOMATIC',
      current: { source: 'UNKNOWN', categoryId: null },
    });
    return decision.outcome === 'DECIDED' ? decision : null;
  }

  /** The decision for an existing row that the caller has locked. */
  decideExisting(
    tx: Prisma.TransactionClient,
    row: LockedTransaction,
    mode: DecisionMode,
  ) {
    return this.decideHeld(tx, factsOf(row), {
      mode,
      current: {
        source: row.classificationSource,
        categoryId: row.categoryId,
      },
    });
  }

  /**
   * decide() over the current rules, with the winning rule held until the
   * caller commits. A winner deleted after the rules were read cannot be
   * held, so the decision is taken again without it.
   */
  private async decideHeld(
    tx: Prisma.TransactionClient,
    facts: ClassificationFacts,
    options: Parameters<typeof decide>[2],
  ): Promise<Decision> {
    for (let attempt = 1; ; attempt++) {
      const decision = decide(
        facts,
        await this.repository.rulesFor(facts.userId, tx),
        options,
      );
      if (
        !decision.ruleId ||
        (await this.repository.lockRule(tx, decision.ruleId))
      ) {
        return decision;
      }
      if (attempt === 3) {
        throw new ConflictException(
          'Classification rules changed during the decision; try again',
        );
      }
    }
  }

  /** Appends the event of one applied decision (CLASS-005). */
  async record(
    tx: Prisma.TransactionClient,
    input: {
      transactionId: string;
      userId: string;
      previousCategoryId: string | null;
      decision: AppliedDecision;
      trigger: CategoryDecisionTrigger;
      actor: DecisionActor;
    },
  ) {
    const event = await this.repository.appendEvent(tx, {
      transactionId: input.transactionId,
      userId: input.userId,
      previousCategoryId: input.previousCategoryId,
      newCategoryId: input.decision.categoryId,
      source: input.decision.source,
      trigger: input.trigger,
      reason: input.decision.reason,
      merchantRuleId: input.decision.ruleId,
      actorType: input.actor.type,
      actorUserId: input.actor.type === 'USER' ? input.actor.userId : null,
      explanation: input.decision.explanation,
    });
    // Ids and enums only (no description or merchant). Written inside the
    // caller's transaction: a rolled-back write leaves this line behind.
    this.logger.log({
      event: 'classification.decision_recorded',
      userId: input.userId,
      transactionId: input.transactionId,
      categoryEventId: event.id,
      categoryId: input.decision.categoryId,
      ruleId: input.decision.ruleId,
      source: input.decision.source,
      trigger: input.trigger,
      reason: input.decision.reason,
      inTransaction: true, // may still roll back with the caller's write
    });
    return event;
  }

  lock(tx: Prisma.TransactionClient, userId: string, id: string) {
    return this.repository.lockTransaction(tx, userId, id);
  }

  /**
   * The automatic rerun of one existing transaction (CLASS-006, TX-004). A
   * MANUAL decision is protected: nothing is written. An unchanged decision
   * writes nothing either, so reruns are idempotent. The write repeats the
   * protection in its predicate as a last line of defence.
   */
  applyAutomatic(userId: string, transactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.repository.lockTransaction(
        tx,
        userId,
        transactionId,
      );
      if (!row) return { outcome: 'NOT_FOUND' as const };
      if (row.classificationSource === 'MANUAL') {
        return { outcome: 'PROTECTED' as const };
      }
      if (!(await this.repository.autoClassificationEnabled(userId, tx))) {
        return { outcome: 'DISABLED' as const };
      }
      const decision = await this.decideExisting(tx, row, 'AUTOMATIC');
      if (decision.outcome !== 'DECIDED') {
        return { outcome: 'PROTECTED' as const };
      }
      if (
        decision.categoryId === row.categoryId &&
        decision.source === row.classificationSource &&
        decision.ruleId === row.classificationRuleId
      ) {
        return { outcome: 'UNCHANGED' as const, decision };
      }
      const { count } = await tx.transaction.updateMany({
        where: {
          id: transactionId,
          userId,
          classificationSource: { not: 'MANUAL' },
        },
        data: decisionColumns(decision, new Date()),
      });
      if (!count) return { outcome: 'PROTECTED' as const };
      const event = await this.record(tx, {
        transactionId,
        userId,
        previousCategoryId: row.categoryId,
        decision,
        trigger: 'AUTOMATIC_RERUN',
        actor: { type: 'SYSTEM' },
      });
      return { outcome: 'APPLIED' as const, decision, eventId: event.id };
    });
  }

  /**
   * The append-only history of one transaction, oldest first (T056). The
   * caller has already checked ownership. Category names are shown when the
   * owner can still read the category (own or system, any status).
   */
  async history(userId: string, transactionId: string) {
    const events = await this.repository.history(userId, transactionId);
    const names = await this.repository.readableCategories(userId, [
      ...new Set(
        events.flatMap((event) =>
          [event.previousCategoryId, event.newCategoryId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    ]);
    const category = (id: string | null) =>
      id === null ? null : { id, name: names.get(id) ?? null };
    return events.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      createdAt: event.createdAt.toISOString(),
      source: event.source,
      trigger: event.trigger,
      reason: event.reason,
      actorType: event.actorType,
      actorUserId: event.actorUserId,
      merchantRuleId: event.merchantRuleId,
      previousCategory: category(event.previousCategoryId),
      newCategory: category(event.newCategoryId),
      explanation: event.explanation,
    }));
  }

  // --- The owner's rules (CLASS-001). Changing a rule never reclassifies
  // existing transactions; it applies to later decisions only.

  async listRules(userId: string) {
    return (await this.repository.listRules(userId)).map(
      toClassificationRuleResponse,
    );
  }

  async createRule(userId: string, dto: CreateClassificationRuleDto) {
    this.assertTextCriterion(dto);
    await this.assertTarget(userId, dto.categoryId);
    const rule = await this.repository.createUserRule(userId, {
      categoryId: dto.categoryId,
      merchantPattern: dto.merchantPattern ?? null,
      descriptionPattern: dto.descriptionPattern ?? null,
      bankName: dto.bankName ?? null,
      direction: dto.direction ?? null,
      priority: dto.priority ?? 100,
      isActive: dto.isActive ?? true,
    });
    return toClassificationRuleResponse(rule);
  }

  async updateRule(
    userId: string,
    id: string,
    dto: UpdateClassificationRuleDto,
  ) {
    const current = await this.repository.findOwnedRule(userId, id);
    if (!current) throw ruleNotFound();
    // A validated DTO has every field as an own key (undefined when absent),
    // so it is merged field by field, never spread over the stored rule.
    const next = (
      key: 'merchantPattern' | 'descriptionPattern' | 'bankName',
    ) => (dto[key] === undefined ? current[key] : dto[key]);
    this.assertTextCriterion({
      merchantPattern: next('merchantPattern'),
      descriptionPattern: next('descriptionPattern'),
      bankName: next('bankName'),
    });
    if (dto.categoryId !== undefined) {
      await this.assertTarget(userId, dto.categoryId);
    }
    if (!(await this.repository.updateUserRule(userId, id, dto))) {
      throw ruleNotFound();
    }
    const updated = await this.repository.findOwnedRule(userId, id);
    if (!updated) throw ruleNotFound();
    return toClassificationRuleResponse(updated);
  }

  async deleteRule(userId: string, id: string) {
    if (!(await this.repository.deleteUserRule(userId, id))) {
      throw ruleNotFound();
    }
    return { id };
  }

  /** A category the owner may not use gets the owner-safe 404 (SEC-005). */
  private async assertTarget(userId: string, categoryId: string) {
    if (!(await this.repository.ruleTargetAllowed({ userId }, categoryId))) {
      throw new NotFoundException('Transaction category not found');
    }
  }

  private assertTextCriterion(rule: {
    merchantPattern?: string | null;
    descriptionPattern?: string | null;
    bankName?: string | null;
  }) {
    if (
      !hasTextCriterion({
        merchantPattern: rule.merchantPattern ?? null,
        descriptionPattern: rule.descriptionPattern ?? null,
        bankName: rule.bankName ?? null,
      })
    ) {
      throw new BadRequestException([
        'A rule needs merchantPattern, descriptionPattern, or bankName',
      ]);
    }
  }
}
