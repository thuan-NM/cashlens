import { Injectable } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import {
  TimeRange,
  visibleTransactionWhere,
} from '../../common/finance/financial-period-policy';
import {
  eligibleTotalsQuery,
  loadFinancialContext,
  toTotalsSummary,
} from '../../common/finance/financial-summary.query';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { buildTransactionWhere } from './query/transactions.query';
import { transactionInclude } from './transactions.mapper';

@Injectable()
export class TransactionsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  financialContext(userId: string) {
    return loadFinancialContext(this.prisma, userId);
  }

  /**
   * One page of visible rows plus the eligible totals of every row matching
   * the same filters, so the page and its totals agree with the dashboard for
   * the same period (TX-003).
   */
  async listByUser(
    userId: string,
    query: ListTransactionsDto,
    options: { baseCurrency: string; month?: TimeRange },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    // Soft-deleted rows never appear in list views, whatever the filter (DATA-004).
    const where = buildTransactionWhere(userId, query, options.month);

    // Repeatable read: the page, its count, and its totals see one snapshot.
    const [data, total, totalsRows] = await this.prisma.$transaction(
      [
        this.prisma.transaction.findMany({
          where,
          include: transactionInclude,
          orderBy: [
            { transactionTime: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.transaction.count({ where }),
        eligibleTotalsQuery(this.prisma, userId, { where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      data,
      total,
      page,
      limit,
      totals: toTotalsSummary(totalsRows, options.baseCurrency),
    };
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, ...visibleTransactionWhere(userId) },
      include: transactionInclude,
    });
  }

  /** One database transaction for a write and its category event (T054). */
  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(work);
  }

  createWithin(
    tx: Prisma.TransactionClient,
    data: Prisma.TransactionUncheckedCreateInput,
  ) {
    return tx.transaction.create({ data, include: transactionInclude });
  }

  /**
   * Writes a row the caller has locked (owner already checked under the
   * lock); an empty change reads the row instead, so a no-op stays a no-op.
   */
  updateLockedWithin(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.TransactionUncheckedUpdateInput,
  ) {
    const changes = Object.values(data).some((value) => value !== undefined);
    return changes
      ? tx.transaction.update({
          where: { id },
          data,
          include: transactionInclude,
        })
      : tx.transaction.findUniqueOrThrow({
          where: { id },
          include: transactionInclude,
        });
  }

  // Every write carries the owner predicate itself (SEC-001), so a row that
  // is not the caller's, or is soft-deleted, resolves to null (owner-safe 404).
  updateById(
    userId: string,
    id: string,
    data: Prisma.TransactionUncheckedUpdateInput,
  ) {
    return this.updateOwned(userId, id, data);
  }

  markDuplicate(
    userId: string,
    id: string,
    duplicateOfTransactionId?: string | null,
  ) {
    return this.updateOwned(userId, id, {
      isDuplicate: Boolean(duplicateOfTransactionId),
      duplicateOfTransactionId: duplicateOfTransactionId ?? null,
    });
  }

  updateStatus(userId: string, id: string, status: TransactionStatus) {
    return this.updateOwned(userId, id, { status });
  }

  private updateOwned(
    userId: string,
    id: string,
    data: Prisma.TransactionUncheckedUpdateInput,
  ) {
    return nullIfNotFound(
      this.prisma.transaction.update({
        where: { id, ...visibleTransactionWhere(userId) },
        data,
        include: transactionInclude,
      }),
    );
  }

  async financialAccountExists(userId: string, id: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    });

    return Boolean(account);
  }

  async categoryExistsForUser(userId: string, id: string) {
    const category = await this.prisma.transactionCategory.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        OR: [{ userId: null }, { userId }],
      },
      select: { id: true },
    });

    return Boolean(category);
  }

  async transactionExistsForUser(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, ...visibleTransactionWhere(userId) },
      select: { id: true },
    });

    return Boolean(transaction);
  }
}
