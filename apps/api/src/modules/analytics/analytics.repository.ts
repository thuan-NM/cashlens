import { Injectable } from '@nestjs/common';
import {
  TimeRange,
  eligibleTransactionWhere,
} from '../../common/finance/financial-period-policy';
import {
  byLocalDate,
  eligibleAmountsByCategory,
  eligibleCashflowBuckets,
  eligibleTotals,
  loadFinancialContext,
} from '../../common/finance/financial-summary.query';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  financialContext(userId: string) {
    return loadFinancialContext(this.prisma, userId);
  }

  totals(userId: string, baseCurrency: string, range: TimeRange) {
    return eligibleTotals(this.prisma, userId, baseCurrency, { range });
  }

  recentTransactions(userId: string, range: TimeRange) {
    return this.prisma.transaction.findMany({
      where: eligibleTransactionWhere(userId, range),
      include: { account: true, category: true },
      orderBy: [
        { transactionTime: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 10,
    });
  }

  amountsByCategory(userId: string, range: TimeRange) {
    return eligibleAmountsByCategory(this.prisma, userId, range);
  }

  findCategories(ids: string[]) {
    return this.prisma.transactionCategory.findMany({
      where: { id: { in: ids } },
    });
  }

  dailyCashflow(
    userId: string,
    range: TimeRange,
    currency: string,
    timeZone: string,
  ) {
    return eligibleCashflowBuckets(
      this.prisma,
      userId,
      range,
      currency,
      byLocalDate(timeZone),
    );
  }
}
