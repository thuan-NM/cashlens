import { Prisma } from '@prisma/client';
import { ListTransactionsDto } from '../dto/list-transactions.dto';

export const buildTransactionWhere = (
  userId: string,
  query: ListTransactionsDto,
): Prisma.TransactionWhereInput => ({
  userId,
  status: query.status ?? { not: 'DELETED' },
  sourceType: query.sourceType,
  financialAccountId: query.financialAccountId,
  categoryId: query.categoryId,
  direction: query.direction,
  transactionTime:
    query.from || query.to
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
});
