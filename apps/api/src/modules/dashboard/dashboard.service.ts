import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeCurrency,
  savingRatePercent,
  toDecimal,
  userMonthsEndingAt,
} from '../../common/finance/financial-period-policy';
import {
  compareCategoryRows,
  emptyCashflowPoint,
} from '../../common/finance/financial-summary.query';
import type { RequestUser } from '../../common/types/request-user.type';
import { toTransactionResponse } from '../transactions/transactions.mapper';
import {
  DashboardCashflowQueryDto,
  DashboardMonthQueryDto,
} from './dto/dashboard-query.dto';
import { dashboardMonth, formatAmount } from './dashboard.mapper';
import { DashboardRepository } from './dashboard.repository';

/**
 * Monthly dashboard over the user's persisted eligible records (DASH-001).
 * Periods are user months (DASH-002). Money figures are in the account's base
 * currency; other currencies are reported separately, never summed in.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async overview(user: RequestUser, query: DashboardMonthQueryDto) {
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = dashboardMonth(context.settings, query.month);
    const [totals, unreadAlerts] = await Promise.all([
      this.dashboardRepository.totals(user.id, context.baseCurrency, month),
      this.dashboardRepository.unreadCriticalAlerts(user.id),
    ]);

    return {
      month: month.key,
      currency: totals.currency,
      income: totals.income,
      expense: totals.expense,
      netCashflow: totals.netCashflow,
      savingRate: savingRatePercent(totals.income, totals.netCashflow),
      transactionCount: totals.transactionCount,
      unreadAlerts,
      currencies: totals.currencies,
      periodStart: month.from.toISOString(),
      periodEnd: month.to.toISOString(),
      timeZone: context.settings.timeZone,
    };
  }

  /** One entry per user month, oldest first, including months with no data. */
  async cashflow(user: RequestUser, query: DashboardCashflowQueryDto) {
    const context = await this.dashboardRepository.financialContext(user.id);
    const last = dashboardMonth(context.settings, query.month);
    const months = userMonthsEndingAt(
      last.key,
      query.months ?? 6,
      context.settings,
    );
    const buckets = await this.dashboardRepository.cashflowByMonth(
      user.id,
      months,
      context.baseCurrency,
    );

    return months.map((month) => ({
      month: month.key,
      ...(buckets.get(month.key) ?? emptyCashflowPoint(context.baseCurrency)),
    }));
  }

  /**
   * Eligible expense per category and currency, uncategorized included.
   * Categories flagged `excludeFromAnalytics` never appear, so the rows add up
   * to the overview expense minus those categories' spending.
   */
  async categoryBreakdown(user: RequestUser, query: DashboardMonthQueryDto) {
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = dashboardMonth(context.settings, query.month);
    const rows = (
      await this.dashboardRepository.expenseByCategory(user.id, month)
    ).sort(compareCategoryRows(context.baseCurrency));
    const categoryIds = rows
      .map((row) => row.categoryId)
      .filter((id): id is string => Boolean(id));
    const categories = await this.dashboardRepository.categories(categoryIds);
    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );

    return rows.map((row) => ({
      categoryId: row.categoryId,
      category: row.categoryId
        ? (categoryMap.get(row.categoryId) ?? null)
        : null,
      currency: row.currency,
      amount: row.amount,
      count: row.count,
    }));
  }

  async recentTransactions(user: RequestUser, query: DashboardMonthQueryDto) {
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = dashboardMonth(context.settings, query.month);
    const transactions = await this.dashboardRepository.recentTransactions(
      user.id,
      month,
      5,
    );
    return transactions.map(toTransactionResponse);
  }

  /** Budgets over their warning threshold, spent in the budget's currency. */
  async hotBudgets(user: RequestUser, query: DashboardMonthQueryDto) {
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = dashboardMonth(context.settings, query.month);
    const budgets = await this.dashboardRepository.activeBudgets(
      user.id,
      month,
    );
    const categoryIds = Array.from(
      new Set(
        budgets
          .map((budget) => budget.categoryId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const spendingRows = categoryIds.length
      ? await this.dashboardRepository.budgetSpending(
          user.id,
          categoryIds,
          month,
        )
      : [];
    // Currency codes that differ only in case are one currency.
    const spentMap = new Map<string, Prisma.Decimal>();
    for (const row of spendingRows) {
      const key = `${row.categoryId ?? ''}|${normalizeCurrency(row.currency)}`;
      spentMap.set(
        key,
        (spentMap.get(key) ?? toDecimal(0)).plus(toDecimal(row._sum.amount)),
      );
    }

    return budgets
      .map((budget) => {
        const amount = toDecimal(budget.amount);
        const spent = budget.categoryId
          ? (spentMap.get(
              `${budget.categoryId}|${normalizeCurrency(budget.currency)}`,
            ) ?? toDecimal(0))
          : toDecimal(0);
        const percentUsed = amount.isZero()
          ? 0
          : Math.round(spent.div(amount).times(100).toNumber());
        const remaining = amount.minus(spent);

        return {
          id: budget.id,
          categoryId: budget.categoryId,
          name: budget.name,
          currency: normalizeCurrency(budget.currency),
          amount: amount.toNumber(),
          spent: spent.toNumber(),
          remaining: remaining.isNegative() ? 0 : remaining.toNumber(),
          percentUsed,
          thresholdPercent: budget.thresholdPercent,
          category: budget.category,
        };
      })
      .filter((budget) => budget.percentUsed >= budget.thresholdPercent)
      .sort(
        (a, b) =>
          b.percentUsed - a.percentUsed ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, 5);
  }

  async insights(user: RequestUser, query: DashboardMonthQueryDto) {
    // Resolve the month once, so both parts describe the same user month
    // even when the request crosses a month boundary (DASH-003).
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = { month: dashboardMonth(context.settings, query.month).key };
    const [overview, hotBudgets] = await Promise.all([
      this.overview(user, month),
      this.hotBudgets(user, month),
    ]);

    const insights: Array<{
      type: string;
      severity: string;
      title: string;
      message: string;
    }> = [];

    if (overview.netCashflow >= 0) {
      insights.push({
        type: 'POSITIVE_CASHFLOW',
        severity: 'INFO',
        title: 'Positive cashflow',
        message: `Net cashflow is ${formatAmount(overview.netCashflow, overview.currency)}.`,
      });
    } else {
      insights.push({
        type: 'NEGATIVE_CASHFLOW',
        severity: 'WARNING',
        title: 'Negative cashflow',
        message: `Spending exceeds income by ${formatAmount(Math.abs(overview.netCashflow), overview.currency)}.`,
      });
    }

    for (const budget of hotBudgets.slice(0, 2)) {
      insights.push({
        type: 'HOT_BUDGET',
        severity: budget.percentUsed > 100 ? 'CRITICAL' : 'WARNING',
        title: `${budget.name} used ${budget.percentUsed}% of budget`,
        message: `Spent ${formatAmount(budget.spent, budget.currency)} / ${formatAmount(budget.amount, budget.currency)}.`,
      });
    }

    return insights;
  }
}
