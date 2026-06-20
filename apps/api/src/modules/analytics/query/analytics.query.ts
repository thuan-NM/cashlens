import { Prisma } from '@prisma/client';
import { RangeAnalyticsQueryDto } from '../dto/analytics-query.dto';

export const monthRange = (month?: string) => {
  const base = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const from = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1),
  );

  return { from, to };
};

export const analyticsRange = (query: RangeAnalyticsQueryDto) => {
  if (query.from || query.to) {
    return {
      from: query.from ? new Date(query.from) : monthRange().from,
      to: query.to ? new Date(query.to) : monthRange().to,
    };
  }

  return monthRange();
};

export const buildAnalyticsTransactionWhere = (
  userId: string,
  range: { from: Date; to: Date },
): Prisma.TransactionWhereInput => ({
  userId,
  status: 'POSTED',
  isDuplicate: false,
  transactionTime: {
    gte: range.from,
    lt: range.to,
  },
});

export const monthKey = (date: Date) => date.toISOString().slice(0, 7);
