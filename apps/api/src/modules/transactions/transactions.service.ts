import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActorType, TransactionStatus } from '@prisma/client';
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
import { UsersRepository } from '../users/users.repository';
import { TransactionsRepository } from './transactions.repository';

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
  ) {}

  /**
   * A page of the owner's visible transactions plus `totals`: the eligible
   * income, expense, and net of every row matching the same filters (not just
   * the page), under the same policy as the dashboard (TX-003).
   */
  async list(user: RequestUser, query: ListTransactionsDto) {
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

  async create(user: RequestUser, dto: CreateTransactionDto) {
    this.rejectNulls(dto);
    const duplicate = this.duplicateFields(dto);
    await this.assertRelatedEntities(user.id, {
      financialAccountId: dto.financialAccountId,
      categoryId: dto.categoryId,
      duplicateOfTransactionId: dto.duplicateOfTransactionId,
    });

    const transaction = await this.transactionsRepository.create({
      ...toCreateTransactionInput(user.id, dto),
      ...duplicate,
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

    const transaction = this.found(
      await this.transactionsRepository.updateById(user.id, id, {
        ...toUpdateTransactionInput(dto),
        ...duplicate,
      }),
    );
    if (dto.categoryId !== undefined) {
      await this.auditCategoryChange(user, before.categoryId, transaction);
    }

    return toTransactionResponse(transaction);
  }

  async updateCategory(
    user: RequestUser,
    id: string,
    dto: UpdateTransactionCategoryDto,
  ) {
    const before = await this.findById(user, id);

    if (dto.categoryId) {
      await this.assertCategoryAllowed(user.id, dto.categoryId);
    }

    const transaction = this.found(
      await this.transactionsRepository.updateCategory(
        user.id,
        id,
        dto.categoryId,
      ),
    );
    await this.auditCategoryChange(user, before.categoryId, transaction);

    return toTransactionResponse(transaction);
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

    return { id };
  }

  /** Category corrections are audited with category ids only (SEC-006). */
  private async auditCategoryChange(
    user: RequestUser,
    fromCategoryId: string | null,
    transaction: { id: string; categoryId: string | null },
  ) {
    if (fromCategoryId === transaction.categoryId) {
      return;
    }
    await this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: 'TRANSACTION_CATEGORY_CORRECTED',
      resourceType: 'transaction',
      resourceId: transaction.id,
      metadata: { fromCategoryId, toCategoryId: transaction.categoryId },
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
