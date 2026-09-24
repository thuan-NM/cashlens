import { Prisma } from '@prisma/client';
import {
  TimeRange,
  visibleTransactionWhere,
} from '../../../common/finance/financial-period-policy';
import { ListTransactionsDto } from '../dto/list-transactions.dto';

/**
 * List filter over the owner's visible rows (never soft-deleted, DATA-004).
 * `month` resolves to the user month's half-open range; otherwise `from` and
 * `to` are inclusive instants, as before.
 */
export const buildTransactionWhere = (
  userId: string,
  query: ListTransactionsDto,
  month?: TimeRange,
): Prisma.TransactionWhereInput => ({
  AND: [
    visibleTransactionWhere(userId),
    {
      status: query.status,
      sourceType: query.sourceType,
      financialAccountId: query.financialAccountId,
      categoryId: query.categoryId,
      direction: query.direction,
      transactionTime: month
        ? { gte: month.from, lt: month.to }
        : query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      OR: query.search
        ? [
            { description: { contains: query.search, mode: 'insensitive' } },
            { merchantName: { contains: query.search, mode: 'insensitive' } },
            {
              counterpartyName: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    },
  ],
});
