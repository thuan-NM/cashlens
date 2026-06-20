import { Injectable } from '@nestjs/common';
import { TransactionDirection } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildAnalyticsTransactionWhere,
} from './query/analytics.query';

@Injectable()
export class AnalyticsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  sumAmount(
    userId: string,
    range: { from: Date; to: Date },
    directions: TransactionDirection[],
  ) {
    return this.prisma.transaction.aggregate({
      where: {
        ...buildAnalyticsTransactionWhere(userId, range),
        direction: { in: directions },
      },
      _sum: { amount: true },
    });
  }

  countPostedTransactions(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.count({
      where: buildAnalyticsTransactionWhere(userId, range),
    });
  }

  recentTransactions(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.findMany({
      where: buildAnalyticsTransactionWhere(userId, range),
      include: { account: true, category: true },
      orderBy: [{ transactionTime: 'desc' }],
      take: 10,
    });
  }

  categoryBreakdown(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.groupBy({
      by: ['categoryId', 'direction'],
      where: {
        ...buildAnalyticsTransactionWhere(userId, range),
        category: { excludeFromAnalytics: false },
      },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
    });
  }

  findCategories(ids: string[]) {
    return this.prisma.transactionCategory.findMany({
      where: { id: { in: ids } },
    });
  }

  cashflowTransactions(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.findMany({
      where: buildAnalyticsTransactionWhere(userId, range),
      select: {
        amount: true,
        direction: true,
        transactionTime: true,
      },
      orderBy: [{ transactionTime: 'asc' }],
    });
  }
}
