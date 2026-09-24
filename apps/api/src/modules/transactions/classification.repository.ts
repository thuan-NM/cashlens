import { Injectable } from '@nestjs/common';
import {
  AuditActorType,
  CategoryDecisionReason,
  CategoryDecisionSource,
  CategoryDecisionTrigger,
  ClassificationSource,
  Prisma,
  TransactionDirection,
} from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClassificationRule } from './classification.service';

/** The Prisma client or an interactive transaction's client. */
export type Db = Prisma.TransactionClient | PrismaService;

/** The columns decide() reads, including the rule's target category. */
export const ruleSelect = {
  id: true,
  userId: true,
  categoryId: true,
  merchantPattern: true,
  descriptionPattern: true,
  bankName: true,
  direction: true,
  priority: true,
  isActive: true,
  createdAt: true,
  category: {
    select: { id: true, userId: true, isSystem: true, status: true },
  },
} satisfies Prisma.MerchantRuleSelect;

export type RuleWrite = {
  categoryId: string;
  merchantPattern?: string | null;
  descriptionPattern?: string | null;
  bankName?: string | null;
  direction?: TransactionDirection | null;
  priority?: number;
  isActive?: boolean;
};

/** A transaction's classification state, read under a row lock. */
export type LockedTransaction = {
  id: string;
  userId: string;
  categoryId: string | null;
  classificationSource: ClassificationSource;
  classificationRuleId: string | null;
  merchantName: string | null;
  counterpartyName: string | null;
  description: string | null;
  bankName: string | null;
  direction: TransactionDirection;
};

export type EventWrite = {
  transactionId: string;
  userId: string;
  previousCategoryId: string | null;
  newCategoryId: string | null;
  source: CategoryDecisionSource;
  trigger: CategoryDecisionTrigger;
  reason: CategoryDecisionReason;
  merchantRuleId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  explanation: Prisma.InputJsonValue | null;
};

const assertUserId = (userId: string) => {
  // An undefined owner would turn Prisma filters into "no filter".
  if (typeof userId !== 'string' || !userId) {
    throw new Error('A classification owner id is required');
  }
};

/**
 * Classification rules (`MerchantRule`, CLASS-001) and the append-only
 * category history (`TransactionCategoryEvent`, CLASS-005). Scope invariant
 * (data-model "MerchantRule ownership", also a DB trigger): a system rule
 * (userId null) targets an ACTIVE system category; a user rule targets an
 * ACTIVE system category or one of its owner's ACTIVE categories.
 */
@Injectable()
export class ClassificationRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** Candidate rules for one owner: its active rules and active system rules. */
  rulesFor(
    userId: string,
    db: Db = this.prisma,
  ): Promise<ClassificationRule[]> {
    assertUserId(userId);
    return db.merchantRule.findMany({
      where: { isActive: true, OR: [{ userId }, { userId: null }] },
      select: ruleSelect,
    });
  }

  /**
   * Holds the winning rule until the caller commits (`FOR KEY SHARE`), so a
   * concurrent delete waits and then clears the reference (`SET NULL`) instead
   * of failing the caller's write. False when the rule is already gone.
   */
  async lockRule(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "MerchantRule" WHERE "id" = ${id} FOR KEY SHARE`;
    return rows.length > 0;
  }

  /** The owner's automatic-classification setting; a missing row means on. */
  async autoClassificationEnabled(userId: string, db: Db = this.prisma) {
    assertUserId(userId);
    const settings = await db.userSettings.findUnique({
      where: { userId },
      select: { autoClassificationEnabled: true },
    });
    return settings?.autoClassificationEnabled ?? true;
  }

  /** Whether a rule of this scope may target the category (T052). */
  async ruleTargetAllowed(
    scope: { userId: string } | 'SYSTEM',
    categoryId: string,
    db: Db = this.prisma,
  ) {
    const where: Prisma.TransactionCategoryWhereInput =
      scope === 'SYSTEM'
        ? { id: categoryId, userId: null, isSystem: true, status: 'ACTIVE' }
        : {
            id: categoryId,
            status: 'ACTIVE',
            OR: [{ userId: null, isSystem: true }, { userId: scope.userId }],
          };
    if (scope !== 'SYSTEM') assertUserId(scope.userId);
    const category = await db.transactionCategory.findFirst({
      where,
      select: { id: true },
    });
    return Boolean(category);
  }

  /** The owner's rules, then the active system rules they are ranked after. */
  listRules(userId: string) {
    assertUserId(userId);
    return this.prisma.merchantRule.findMany({
      where: { OR: [{ userId }, { userId: null, isActive: true }] },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  findOwnedRule(userId: string, id: string) {
    assertUserId(userId);
    return this.prisma.merchantRule.findFirst({ where: { id, userId } });
  }

  createUserRule(userId: string, data: RuleWrite) {
    assertUserId(userId);
    return this.prisma.merchantRule.create({ data: { ...data, userId } });
  }

  /** System rules have no HTTP route: operators and tests only (T052). */
  createSystemRule(data: RuleWrite) {
    return this.prisma.merchantRule.create({ data: { ...data, userId: null } });
  }

  /** Owner-scoped; 0 when the caller owns no such rule. */
  async updateUserRule(userId: string, id: string, data: Partial<RuleWrite>) {
    assertUserId(userId);
    const { count } = await this.prisma.merchantRule.updateMany({
      where: { id, userId },
      data,
    });
    return count;
  }

  async deleteUserRule(userId: string, id: string) {
    assertUserId(userId);
    const { count } = await this.prisma.merchantRule.deleteMany({
      where: { id, userId },
    });
    return count;
  }

  /**
   * Locks the owner's visible transaction row for the rest of the database
   * transaction, so concurrent category writers are serialized and each
   * event's previous category is the state it actually replaced.
   *
   * Lock order: the rule the row references first, then the row. Deleting a
   * rule locks the rule and then, through ON DELETE SET NULL, the rows that
   * reference it; taking the two in the same order cannot deadlock with it.
   * A different winning rule, held later, never cascades into this row.
   */
  async lockTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ): Promise<LockedTransaction | null> {
    assertUserId(userId);
    const [current] = await tx.$queryRaw<
      Array<{ classificationRuleId: string | null }>
    >`
      SELECT "classificationRuleId" FROM "Transaction"
      WHERE "id" = ${id} AND "userId" = ${userId}`;
    if (current?.classificationRuleId) {
      await this.lockRule(tx, current.classificationRuleId);
    }
    const rows = await tx.$queryRaw<LockedTransaction[]>`
      SELECT "id", "userId", "categoryId", "classificationSource",
             "classificationRuleId", "merchantName", "counterpartyName",
             "description", "bankName", "direction"
      FROM "Transaction"
      WHERE "id" = ${id} AND "userId" = ${userId} AND "status" <> 'DELETED'
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Appends one event (CLASS-005). Called with the transaction row locked, so
   * `sequence` (max + 1) is the append order; the unique (transactionId,
   * sequence) index refuses any unlocked concurrent append.
   */
  async appendEvent(tx: Prisma.TransactionClient, data: EventWrite) {
    const last = await tx.transactionCategoryEvent.aggregate({
      where: { transactionId: data.transactionId },
      _max: { sequence: true },
    });
    return tx.transactionCategoryEvent.create({
      data: {
        ...data,
        explanation: data.explanation ?? Prisma.DbNull,
        sequence: (last._max.sequence ?? 0) + 1,
      },
    });
  }

  /** The owner's events for one transaction, oldest first. */
  history(userId: string, transactionId: string) {
    assertUserId(userId);
    return this.prisma.transactionCategoryEvent.findMany({
      where: { transactionId, userId },
      orderBy: { sequence: 'asc' },
    });
  }

  /** Names of the categories the owner can read (own or system, any status). */
  async readableCategories(userId: string, ids: string[]) {
    assertUserId(userId);
    if (!ids.length) return new Map<string, string>();
    const rows = await this.prisma.transactionCategory.findMany({
      where: { id: { in: ids }, OR: [{ userId: null }, { userId }] },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
