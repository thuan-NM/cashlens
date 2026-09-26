import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActorType, Prisma, TransactionStatus } from '@prisma/client';
import { userMonthForKey } from '../../common/finance/financial-period-policy';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { MarkDuplicateDto } from './dto/mark-duplicate.dto';
import { UpdateTransactionCategoryDto } from './dto/update-transaction-category.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import {
  toCreateTransactionInput,
  toTransactionResponse,
  toUpdateTransactionInput,
} from './transactions.mapper';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { UsersRepository } from '../users/users.repository';
import {
  ClassificationService,
  decisionColumns,
  manualDecision,
} from './classification.service';
import { TransactionListResponseDto } from './dto/transaction.response';
import { TransactionsRepository } from './transactions.repository';

/**
 * Fields whose change re-evaluates a transaction's large-transaction alert
 * (ALERT-009: amount, currency, direction, or eligibility).
 */
const LARGE_TRANSACTION_FIELDS = [
  'amount',
  'currency',
  'direction',
  'status',
  'isDuplicate',
  'duplicateOfTransactionId',
] as const;

/** Fields every transaction carries: null cannot clear them (TX-002). */
const NOT_NULLABLE = [
  'amount',
  'currency',
  'direction',
  'transactionTime',
  'status',
  'isDuplicate',
  'duplicateOfTransactionId',
] as const;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly transactionsRepository: TransactionsRepository,
    private readonly users: UsersRepository,
    private readonly classification: ClassificationService,
    private readonly alerts: AlertEvaluationService,
  ) {}

  /**
   * A page of the owner's visible transactions plus `totals`: the eligible
   * income, expense, and net of every row matching the same filters (not just
   * the page), under the same policy as the dashboard (TX-003).
   */
  async list(
    user: RequestUser,
    query: ListTransactionsDto,
  ): Promise<TransactionListResponseDto> {
    if (query.month && (query.from || query.to)) {
      throw new BadRequestException([
        'month cannot be combined with from or to',
      ]);
    }
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException(['from must not be after to']);
    }
    const context = await this.transactionsRepository.financialContext(user.id);
    const { data, total, page, limit, totals } =
      await this.transactionsRepository.listByUser(user.id, query, {
        baseCurrency: context.baseCurrency,
        month: query.month
          ? userMonthForKey(query.month, context.settings)
          : undefined,
      });

    return {
      data: data.map(toTransactionResponse),
      total,
      page,
      limit,
      totals,
    };
  }

  async findById(user: RequestUser, id: string) {
    const transaction = await this.transactionsRepository.findByIdForUser(
      user.id,
      id,
    );

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return toTransactionResponse(transaction);
  }

  /**
   * A category chosen by the owner is a MANUAL decision; otherwise the
   * automatic decision applies (T055). The row and its first category event
   * are written together, after every validation has passed.
   */
  async create(user: RequestUser, dto: CreateTransactionDto) {
    this.rejectNulls(dto);
    const duplicate = this.duplicateFields(dto);
    await this.assertRelatedEntities(user.id, {
      financialAccountId: dto.financialAccountId,
      categoryId: dto.categoryId,
      duplicateOfTransactionId: dto.duplicateOfTransactionId,
    });

    const input = { ...toCreateTransactionInput(user.id, dto), ...duplicate };
    const transaction = await this.transactionsRepository.runInTransaction(
      async (tx) => {
        const decision = dto.categoryId
          ? manualDecision(dto.categoryId)
          : await this.classification.decideNew(tx, {
              userId: user.id,
              merchantName: input.merchantName,
              counterpartyName: input.counterpartyName,
              description: input.description,
              direction: input.direction,
            });
        const row = await this.transactionsRepository.createWithin(tx, {
          ...input,
          ...(decision
            ? decisionColumns(decision, new Date())
            : { classificationSource: 'UNKNOWN' as const }),
        });
        if (decision) {
          await this.classification.record(tx, {
            transactionId: row.id,
            userId: user.id,
            previousCategoryId: null,
            decision,
            trigger: 'CREATE',
            actor: dto.categoryId
              ? { type: 'USER', userId: user.id }
              : { type: 'SYSTEM' },
          });
        }
        return row;
      },
    );

    // After the commit; evaluation never fails the write (ALERT-009).
    await this.alerts.onTransactionsChanged(user.id, {
      largeTransactionIds: [transaction.id],
    });
    return toTransactionResponse(transaction);
  }

  async update(user: RequestUser, id: string, dto: UpdateTransactionDto) {
    this.rejectNulls(dto);
    const before = await this.findById(user, id);
    const duplicate = this.duplicateFields(dto, before);
    await this.assertRelatedEntities(user.id, {
      financialAccountId: dto.financialAccountId,
      categoryId: dto.categoryId,
      duplicateOfTransactionId: dto.duplicateOfTransactionId,
    });

    const changes = { ...toUpdateTransactionInput(dto), ...duplicate };
    const transaction =
      dto.categoryId === undefined
        ? // No category in the request: the classification is left as it is.
          this.found(
            await this.transactionsRepository.updateById(user.id, id, changes),
          )
        : (
            await this.correctCategory(
              user,
              id,
              dto.categoryId ?? null,
              changes,
            )
          ).transaction;
    const sent = { ...dto, ...duplicate } as Record<string, unknown>;
    await this.alerts.onTransactionsChanged(user.id, {
      largeTransactionIds: LARGE_TRANSACTION_FIELDS.some(
        (field) => sent[field] !== undefined,
      )
        ? [id]
        : [],
    });
    return toTransactionResponse(transaction);
  }

  /** The authoritative manual correction (TX-004, CLASS-005). */
  async updateCategory(
    user: RequestUser,
    id: string,
    dto: UpdateTransactionCategoryDto,
  ) {
    await this.findById(user, id);

    if (dto.categoryId) {
      await this.assertCategoryAllowed(user.id, dto.categoryId);
    }

    const { transaction, decision, eventId } = await this.correctCategory(
      user,
      id,
      dto.categoryId ?? null,
    );
    await this.alerts.onTransactionsChanged(user.id);
    return {
      ...toTransactionResponse(transaction),
      decision: { source: decision.source, reason: decision.reason, eventId },
    };
  }

  /**
   * Explicit reclassification (CLASS-006): releases a manual lock and applies
   * the rules now, recording who asked. Always appends an event and an audit
   * row, even when the outcome is unchanged, because the user asked for it.
   */
  async reclassify(user: RequestUser, id: string) {
    await this.findById(user, id);

    const result = await this.transactionsRepository.runInTransaction(
      async (tx) => {
        const row = await this.classification.lock(tx, user.id, id);
        if (!row) throw new NotFoundException('Transaction not found');
        const decision = await this.classification.decideExisting(
          tx,
          row,
          'EXPLICIT',
        );
        if (decision.outcome !== 'DECIDED') {
          throw new Error('An explicit reclassification always decides');
        }
        const transaction =
          await this.transactionsRepository.updateLockedWithin(
            tx,
            id,
            decisionColumns(decision, new Date()),
          );
        const event = await this.classification.record(tx, {
          transactionId: id,
          userId: user.id,
          previousCategoryId: row.categoryId,
          decision,
          trigger: 'EXPLICIT_RECLASSIFY',
          actor: { type: 'USER', userId: user.id },
        });
        await this.users.recordAudit(
          {
            actorType: AuditActorType.USER,
            actorId: user.id,
            action: 'TRANSACTION_RECLASSIFIED',
            resourceType: 'transaction',
            resourceId: id,
            metadata: {
              fromCategoryId: row.categoryId,
              toCategoryId: decision.categoryId,
              source: decision.source,
            },
          },
          tx,
        );
        return { transaction, decision, eventId: event.id };
      },
    );

    await this.alerts.onTransactionsChanged(user.id);
    return {
      ...toTransactionResponse(result.transaction),
      decision: {
        source: result.decision.source,
        categoryId: result.decision.categoryId,
        ruleId: result.decision.ruleId,
        reason: result.decision.reason,
        explanation: result.decision.explanation,
        eventId: result.eventId,
      },
    };
  }

  /** The owner's append-only category history, oldest first (T056). */
  async categoryHistory(user: RequestUser, id: string) {
    await this.findById(user, id);
    return this.classification.history(user.id, id);
  }

  async markDuplicate(user: RequestUser, id: string, dto: MarkDuplicateDto) {
    await this.findById(user, id);

    if (dto.duplicateOfTransactionId === id) {
      throw new BadRequestException('Transaction cannot duplicate itself');
    }

    if (dto.duplicateOfTransactionId) {
      await this.assertTransactionOwned(user.id, dto.duplicateOfTransactionId);
    }

    const transaction = this.found(
      await this.transactionsRepository.markDuplicate(
        user.id,
        id,
        dto.duplicateOfTransactionId,
      ),
    );

    await this.alerts.onTransactionsChanged(user.id, {
      largeTransactionIds: [id],
    });
    return toTransactionResponse(transaction);
  }

  async ignore(user: RequestUser, id: string) {
    await this.findById(user, id);

    const transaction = this.found(
      await this.transactionsRepository.updateStatus(
        user.id,
        id,
        TransactionStatus.IGNORED,
      ),
    );

    await this.alerts.onTransactionsChanged(user.id, {
      largeTransactionIds: [id],
    });
    return toTransactionResponse(transaction);
  }

  async delete(user: RequestUser, id: string) {
    await this.findById(user, id);

    this.found(
      await this.transactionsRepository.updateStatus(
        user.id,
        id,
        TransactionStatus.DELETED,
      ),
    );
    await this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: 'TRANSACTION_DELETED',
      resourceType: 'transaction',
      resourceId: id,
    });

    await this.alerts.onTransactionsChanged(user.id, {
      largeTransactionIds: [id],
    });
    return { id };
  }

  /**
   * A manual category decision (TX-004), in one database transaction with
   * the row locked, so the event's previous category is the state it really
   * replaced. The event is appended when the decision changes (category or
   * source); the audit, with category ids only (SEC-006), when the category
   * changes. Repeating the same manual choice writes nothing.
   */
  private correctCategory(
    user: RequestUser,
    id: string,
    categoryId: string | null,
    changes: Prisma.TransactionUncheckedUpdateInput = {},
  ) {
    return this.transactionsRepository.runInTransaction(async (tx) => {
      const row = await this.classification.lock(tx, user.id, id);
      if (!row) throw new NotFoundException('Transaction not found');
      const decision = manualDecision(categoryId);
      const categoryChanged = row.categoryId !== categoryId;
      const decisionChanged =
        categoryChanged || row.classificationSource !== 'MANUAL';
      const transaction = await this.transactionsRepository.updateLockedWithin(
        tx,
        id,
        {
          ...changes,
          ...(decisionChanged ? decisionColumns(decision, new Date()) : {}),
        },
      );
      const event = decisionChanged
        ? await this.classification.record(tx, {
            transactionId: id,
            userId: user.id,
            previousCategoryId: row.categoryId,
            decision,
            trigger: 'MANUAL_CORRECTION',
            actor: { type: 'USER', userId: user.id },
          })
        : null;
      if (categoryChanged) {
        await this.users.recordAudit(
          {
            actorType: AuditActorType.USER,
            actorId: user.id,
            action: 'TRANSACTION_CATEGORY_CORRECTED',
            resourceType: 'transaction',
            resourceId: id,
            metadata: {
              fromCategoryId: row.categoryId,
              toCategoryId: categoryId,
            },
          },
          tx,
        );
      }
      return { transaction, decision, eventId: event?.id ?? null };
    });
  }

  /** Optional fields may be omitted, but never sent as null. */
  private rejectNulls(dto: CreateTransactionDto | UpdateTransactionDto) {
    const sent = dto as Record<string, unknown>;
    const fields = NOT_NULLABLE.filter((field) => sent[field] === null);
    if (fields.length) {
      throw new BadRequestException(
        fields.map((field) =>
          field === 'duplicateOfTransactionId'
            ? 'duplicateOfTransactionId must be a transaction id; send isDuplicate false to clear it'
            : `${field} must not be null`,
        ),
      );
    }
  }

  /**
   * isDuplicate and duplicateOfTransactionId describe one state (TX-002,
   * TX-003): a confirmed duplicate names the transaction it duplicates. A
   * reference alone marks the record as a duplicate, as PATCH /:id/duplicate
   * does; isDuplicate false clears the reference.
   */
  private duplicateFields(
    dto: { isDuplicate?: boolean; duplicateOfTransactionId?: string },
    current?: { id: string; duplicateOfTransactionId: string | null },
  ): { isDuplicate?: boolean; duplicateOfTransactionId?: string | null } {
    const reference = dto.duplicateOfTransactionId;
    if (current && reference === current.id) {
      throw new BadRequestException([
        'duplicateOfTransactionId must not reference the transaction itself',
      ]);
    }
    if (dto.isDuplicate === false) {
      if (reference) {
        throw new BadRequestException([
          'isDuplicate cannot be false when duplicateOfTransactionId is set',
        ]);
      }
      return { isDuplicate: false, duplicateOfTransactionId: null };
    }
    if (
      dto.isDuplicate === true &&
      !reference &&
      !current?.duplicateOfTransactionId
    ) {
      throw new BadRequestException([
        'duplicateOfTransactionId is required when isDuplicate is true',
      ]);
    }
    if (reference) {
      return { isDuplicate: true, duplicateOfTransactionId: reference };
    }
    return dto.isDuplicate === true ? { isDuplicate: true } : {};
  }

  private found<T>(transaction: T | null): T {
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }

  private async assertRelatedEntities(
    userId: string,
    ids: {
      financialAccountId?: string;
      categoryId?: string;
      duplicateOfTransactionId?: string | null;
    },
  ) {
    if (ids.financialAccountId) {
      const accountExists =
        await this.transactionsRepository.financialAccountExists(
          userId,
          ids.financialAccountId,
        );

      if (!accountExists) {
        throw new NotFoundException('Financial account not found');
      }
    }

    if (ids.categoryId) {
      await this.assertCategoryAllowed(userId, ids.categoryId);
    }

    if (ids.duplicateOfTransactionId) {
      await this.assertTransactionOwned(userId, ids.duplicateOfTransactionId);
    }
  }

  private async assertCategoryAllowed(userId: string, categoryId: string) {
    const categoryExists =
      await this.transactionsRepository.categoryExistsForUser(
        userId,
        categoryId,
      );

    if (!categoryExists) {
      throw new NotFoundException('Transaction category not found');
    }
  }

  private async assertTransactionOwned(userId: string, transactionId: string) {
    const transactionExists =
      await this.transactionsRepository.transactionExistsForUser(
        userId,
        transactionId,
      );

    if (!transactionExists) {
      throw new NotFoundException('Related transaction not found');
    }
  }
}
