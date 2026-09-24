import { Injectable } from '@nestjs/common';
import { compareCategoryRows } from '../../common/finance/financial-summary.query';
import type { RequestUser } from '../../common/types/request-user.type';
import {
  MonthlyAnalyticsQueryDto,
  RangeAnalyticsQueryDto,
} from './dto/analytics-query.dto';
import { toMonthlySummaryResponse } from './analytics.mapper';
import { analyticsMonth, analyticsRange } from './query/analytics.query';
import { AnalyticsRepository } from './analytics.repository';

/** Analytics over the shared eligibility and period policy (TX-003, DASH-002). */
@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepository: AnalyticsRepository) {}

  async monthlySummary(user: RequestUser, query: MonthlyAnalyticsQueryDto) {
    const context = await this.analyticsRepository.financialContext(user.id);
    const month = analyticsMonth(context.settings, query.month);
    const [totals, recentTransactions] = await Promise.all([
      this.analyticsRepository.totals(user.id, context.baseCurrency, month),
      this.analyticsRepository.recentTransactions(user.id, month),
    ]);

    return toMonthlySummaryResponse({ month, totals, recentTransactions });
  }

  /** Eligible amounts per category, direction, and currency. */
  async categoryBreakdown(user: RequestUser, query: MonthlyAnalyticsQueryDto) {
    const context = await this.analyticsRepository.financialContext(user.id);
    const month = analyticsMonth(context.settings, query.month);
    const rows = (
      await this.analyticsRepository.amountsByCategory(user.id, month)
    ).sort(compareCategoryRows(context.baseCurrency));

    const categoryIds = rows
      .map((row) => row.categoryId)
      .filter((id): id is string => Boolean(id));
    const categories =
      await this.analyticsRepository.findCategories(categoryIds);
    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );

    return rows.map((row) => ({
      categoryId: row.categoryId,
      category: row.categoryId
        ? (categoryMap.get(row.categoryId) ?? null)
        : null,
      direction: row.direction,
      currency: row.currency,
      amount: row.amount,
      count: row.count,
    }));
  }

  /** Base-currency income and expense per local date of the user. */
  async cashflow(user: RequestUser, query: RangeAnalyticsQueryDto) {
    const context = await this.analyticsRepository.financialContext(user.id);
    const range = analyticsRange(query, context.settings);
    const days = await this.analyticsRepository.dailyCashflow(
      user.id,
      range,
      context.baseCurrency,
      context.settings.timeZone,
    );

    return [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, point]) => ({ date, ...point }));
  }
}
