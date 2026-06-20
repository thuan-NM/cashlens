import { Injectable } from '@nestjs/common';
import { TransactionDirection } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import {
  MonthlyAnalyticsQueryDto,
  RangeAnalyticsQueryDto,
} from './dto/analytics-query.dto';
import {
  decimalToNumber,
  toMonthlySummaryResponse,
} from './analytics.mapper';
import {
  analyticsRange,
  monthKey,
  monthRange,
} from './query/analytics.query';
import { AnalyticsRepository } from './analytics.repository';

@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepository: AnalyticsRepository) {}

  async monthlySummary(user: RequestUser, query: MonthlyAnalyticsQueryDto) {
    const range = monthRange(query.month);
    const [income, expense, count, recentTransactions] = await Promise.all([
      this.analyticsRepository.sumAmount(user.id, range, [
        TransactionDirection.INCOME,
      ]),
      this.analyticsRepository.sumAmount(user.id, range, [
        TransactionDirection.EXPENSE,
      ]),
      this.analyticsRepository.countPostedTransactions(user.id, range),
      this.analyticsRepository.recentTransactions(user.id, range),
    ]);

    return toMonthlySummaryResponse({
      month: monthKey(range.from),
      income: decimalToNumber(income._sum.amount),
      expense: decimalToNumber(expense._sum.amount),
      transactionCount: count,
      recentTransactions,
    });
  }

  async categoryBreakdown(user: RequestUser, query: MonthlyAnalyticsQueryDto) {
    const range = monthRange(query.month);
    const rows = await this.analyticsRepository.categoryBreakdown(
      user.id,
      range,
    );

    const categoryIds = rows
      .map((row) => row.categoryId)
      .filter((id): id is string => Boolean(id));
    const categories = await this.analyticsRepository.findCategories(categoryIds);
    const categoryMap = new Map(categories.map((category) => [category.id, category]));

    return rows.map((row) => ({
      categoryId: row.categoryId,
      category: row.categoryId ? categoryMap.get(row.categoryId) ?? null : null,
      direction: row.direction,
      amount: decimalToNumber(row._sum.amount),
      count: row._count._all,
    }));
  }

  async cashflow(user: RequestUser, query: RangeAnalyticsQueryDto) {
    const range = analyticsRange(query);
    const transactions = await this.analyticsRepository.cashflowTransactions(
      user.id,
      range,
    );

    const days = new Map<
      string,
      { date: string; income: number; expense: number; netCashflow: number }
    >();

    for (const transaction of transactions) {
      const date = transaction.transactionTime.toISOString().slice(0, 10);
      const current =
        days.get(date) ?? { date, income: 0, expense: 0, netCashflow: 0 };
      const amount = decimalToNumber(transaction.amount);

      if (transaction.direction === TransactionDirection.INCOME) {
        current.income += amount;
      }

      if (transaction.direction === TransactionDirection.EXPENSE) {
        current.expense += amount;
      }

      current.netCashflow = current.income - current.expense;
      days.set(date, current);
    }

    return Array.from(days.values());
  }

}
