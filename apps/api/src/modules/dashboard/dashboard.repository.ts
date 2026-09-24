import { Injectable } from '@nestjs/common';
import {
  BudgetSpendScope,
  budgetSpend,
} from '../../common/finance/budget-spend.query';
import {
  EXPENSE_DIRECTIONS,
  TimeRange,
  UserMonth,
  eligibleTransactionWhere,
  isInRange,
} from '../../common/finance/financial-period-policy';
import {
  eligibleAmountsByCategory,
  eligibleCashflowBuckets,
  eligibleTotals,
  loadFinancialContext,
} from '../../common/finance/financial-summary.query';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  financialContext(userId: string) {
    return loadFinancialContext(this.prisma, userId);
  }

  totals(userId: string, baseCurrency: string, range: TimeRange) {
    return eligibleTotals(this.prisma, userId, baseCurrency, { range });
  }

  expenseByCategory(userId: string, range: TimeRange) {
    return eligibleAmountsByCategory(
      this.prisma,
      userId,
      range,
      EXPENSE_DIRECTIONS,
    );
  }

  cashflowByMonth(userId: string, months: UserMonth[], currency: string) {
    return eligibleCashflowBuckets(
      this.prisma,
      userId,
      { from: months[0].from, to: months[months.length - 1].to },
      currency,
      (instant) =>
        months.find((month) => isInRange(instant, month))?.key ?? null,
    );
  }

  recentTransactions(userId: string, range: TimeRange, limit = 5) {
    return this.prisma.transaction.findMany({
      where: eligibleTransactionWhere(userId, range),
      include: { account: true, category: true },
      orderBy: [
        { transactionTime: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit,
    });
  }

  categories(ids: string[]) {
    return this.prisma.transactionCategory.findMany({
      where: { id: { in: ids } },
    });
  }

  activeBudgets(userId: string, range: TimeRange) {
    return this.prisma.budget.findMany({
      where: {
        userId,
        deletedAt: null,
        isActive: true,
        startsAt: { lt: range.to },
        OR: [{ endsAt: null }, { endsAt: { gte: range.from } }],
      },
      include: { category: true },
    });
  }

  /** The shared budget spend aggregate (BUDGET-002), per scope id. */
  budgetSpend(userId: string, scopes: BudgetSpendScope[]) {
    return budgetSpend(this.prisma, userId, scopes);
  }

  unreadCriticalAlerts(userId: string) {
    return this.prisma.alert.count({
      where: {
        userId,
        isRead: false,
        severity: { in: ['WARNING', 'CRITICAL'] },
      },
    });
  }
}
