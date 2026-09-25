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
import { monthlyInstanceForMonth } from '../../common/finance/budget-spend.query';
import type { RequestUser } from '../../common/types/request-user.type';
import { budgetThresholdState } from '../../common/finance/budget-threshold.policy';
import { toTransactionResponse } from '../transactions/transactions.mapper';
import {
  DashboardCashflowQueryDto,
  DashboardMonthQueryDto,
} from './dto/dashboard-query.dto';
import { dashboardMonth, formatAmount } from './dashboard.mapper';
import { DashboardRepository } from './dashboard.repository';
import {
  CashflowMonthResponseDto,
  CategoryBreakdownRowResponseDto,
  DashboardInsightResponseDto,
  DashboardOverviewResponseDto,
  HotBudgetResponseDto,
} from './dto/dashboard.response';
import type { TransactionResponseDto } from '../transactions/dto/transaction.response';

/**
 * Monthly dashboard over the user's persisted eligible records (DASH-001).
 * Periods are user months (DASH-002). Money figures are in the account's base
 * currency; other currencies are reported separately, never summed in.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async overview(
    user: RequestUser,
    query: DashboardMonthQueryDto,
  ): Promise<DashboardOverviewResponseDto> {
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
  async cashflow(
    user: RequestUser,
    query: DashboardCashflowQueryDto,
  ): Promise<CashflowMonthResponseDto[]> {
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
  async categoryBreakdown(
    user: RequestUser,
    query: DashboardMonthQueryDto,
  ): Promise<CategoryBreakdownRowResponseDto[]> {
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

  async recentTransactions(
    user: RequestUser,
    query: DashboardMonthQueryDto,
  ): Promise<TransactionResponseDto[]> {
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = dashboardMonth(context.settings, query.month);
    const transactions = await this.dashboardRepository.recentTransactions(
      user.id,
      month,
      5,
    );
    return transactions.map(toTransactionResponse);
  }

  /**
   * Budgets at or over their threshold in the month, by the shared threshold
   * rule and spend aggregate (BUDGET-002, BUDGET-004), each in its own
   * currency. A MONTHLY budget counts its period instance in that month; the
   * other periods count the whole month. Read-only: no alert is written.
   */
  async hotBudgets(
    user: RequestUser,
    query: DashboardMonthQueryDto,
  ): Promise<HotBudgetResponseDto[]> {
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = dashboardMonth(context.settings, query.month);
    const budgets = await this.dashboardRepository.activeBudgets(
      user.id,
      month,
    );
    const scoped = budgets.flatMap((budget) => {
      if (budget.period !== 'MONTHLY') return [{ budget, range: month }];
      const result = monthlyInstanceForMonth(budget, month, context.settings);
      return result.supported && result.instance
        ? [{ budget, range: result.instance.usage }]
        : [];
    });
    const spend = await this.dashboardRepository.budgetSpend(
      user.id,
      scoped.map(({ budget, range }) => ({
        id: budget.id,
        categoryId: budget.categoryId,
        currency: budget.currency,
        range,
      })),
    );

    return scoped
      .map(({ budget }) => {
        const amount = toDecimal(budget.amount);
        const spent = spend.get(budget.id) ?? toDecimal(0);
        const state = budgetThresholdState({
          thresholdPercent: budget.thresholdPercent,
          amount,
          spent,
        });
        const remaining = amount.minus(spent);

        return {
          id: budget.id,
          categoryId: budget.categoryId,
          name: budget.name,
          currency: normalizeCurrency(budget.currency),
          amount: amount.toNumber(),
          spent: spent.toNumber(),
          remaining: remaining.isNegative() ? 0 : remaining.toNumber(),
          percentUsed: state.percentUsed
            ? state.percentUsed
                .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
                .toNumber()
            : 0,
          thresholdPercent: budget.thresholdPercent,
          category: budget.category,
          isNearThreshold: state.isNearThreshold,
        };
      })
      .filter((budget) => budget.isNearThreshold)
      .map((budget) => {
        const { isNearThreshold, ...view } = budget;
        void isNearThreshold; // filtered on, not returned
        return view;
      })
      .sort(
        (a, b) =>
          b.percentUsed - a.percentUsed ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, 5);
  }

  async insights(
    user: RequestUser,
    query: DashboardMonthQueryDto,
  ): Promise<DashboardInsightResponseDto[]> {
    // Resolve the month once, so both parts describe the same user month
    // even when the request crosses a month boundary (DASH-003).
    const context = await this.dashboardRepository.financialContext(user.id);
    const month = { month: dashboardMonth(context.settings, query.month).key };
    const [overview, hotBudgets] = await Promise.all([
      this.overview(user, month),
      this.hotBudgets(user, month),
    ]);

    const insights: DashboardInsightResponseDto[] = [];

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
