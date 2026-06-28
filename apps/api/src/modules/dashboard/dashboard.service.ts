import { Injectable } from '@nestjs/common';
import { Prisma, TransactionDirection } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import { toTransactionResponse } from '../transactions/transactions.mapper';
import {
  DashboardCashflowQueryDto,
  DashboardMonthQueryDto,
} from './dto/dashboard-query.dto';
import {
  dashboardMonthRange,
  dashboardMonthsRange,
  monthKey,
} from './dashboard.mapper';
import { DashboardRepository } from './dashboard.repository';

const decimalToNumber = (value: Prisma.Decimal | null | undefined) =>
  value ? Number(value.toString()) : 0;

@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  async overview(user: RequestUser, query: DashboardMonthQueryDto) {
    const range = dashboardMonthRange(query.month);
    const [income, expense, transactionCount, unreadAlerts] = await Promise.all(
      [
        this.dashboardRepository.sumAmount(user.id, range, [
          TransactionDirection.INCOME,
        ]),
        this.dashboardRepository.sumAmount(user.id, range, [
          TransactionDirection.EXPENSE,
        ]),
        this.dashboardRepository.countTransactions(user.id, range),
        this.dashboardRepository.unreadCriticalAlerts(user.id),
      ],
    );

    const incomeAmount = decimalToNumber(income._sum.amount);
    const expenseAmount = decimalToNumber(expense._sum.amount);
    const netCashflow = incomeAmount - expenseAmount;
    const savingRate =
      incomeAmount === 0 ? 0 : Math.round((netCashflow / incomeAmount) * 100);

    return {
      month: monthKey(range.from),
      income: incomeAmount,
      expense: expenseAmount,
      netCashflow,
      savingRate,
      transactionCount,
      unreadAlerts,
    };
  }

  async cashflow(user: RequestUser, query: DashboardCashflowQueryDto) {
    const range = dashboardMonthsRange(query.months ?? 6);
    const transactions = await this.dashboardRepository.cashflowTransactions(
      user.id,
      range,
    );
    const months = new Map<
      string,
      { month: string; income: number; expense: number; netCashflow: number }
    >();

    for (const transaction of transactions) {
      const month = monthKey(transaction.transactionTime);
      const current = months.get(month) ?? {
        month,
        income: 0,
        expense: 0,
        netCashflow: 0,
      };
      const amount = decimalToNumber(transaction.amount);

      if (transaction.direction === TransactionDirection.INCOME) {
        current.income += amount;
      }

      if (transaction.direction === TransactionDirection.EXPENSE) {
        current.expense += amount;
      }

      current.netCashflow = current.income - current.expense;
      months.set(month, current);
    }

    return Array.from(months.values());
  }

  async categoryBreakdown(user: RequestUser, query: DashboardMonthQueryDto) {
    const range = dashboardMonthRange(query.month);
    const rows = await this.dashboardRepository.categoryBreakdown(
      user.id,
      range,
    );
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
      amount: decimalToNumber(row._sum.amount),
      count: row._count._all,
    }));
  }

  async recentTransactions(user: RequestUser, query: DashboardMonthQueryDto) {
    const range = dashboardMonthRange(query.month);
    const transactions = await this.dashboardRepository.recentTransactions(
      user.id,
      range,
      5,
    );
    return transactions.map(toTransactionResponse);
  }

  async hotBudgets(user: RequestUser, query: DashboardMonthQueryDto) {
    const range = dashboardMonthRange(query.month);
    const budgets = await this.dashboardRepository.activeBudgets(
      user.id,
      range,
    );
    const categoryIds = Array.from(
      new Set(
        budgets
          .map((budget) => budget.categoryId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const spendingRows = await this.dashboardRepository.budgetSpending(
      user.id,
      categoryIds,
      range,
    );
    const spentMap = new Map(
      spendingRows.map((row) => [
        row.categoryId ?? '',
        decimalToNumber(row._sum.amount),
      ]),
    );

    return budgets
      .map((budget) => {
        const amount = decimalToNumber(budget.amount);
        const spent = budget.categoryId
          ? (spentMap.get(budget.categoryId) ?? 0)
          : 0;
        const percentUsed =
          amount === 0 ? 0 : Math.round((spent / amount) * 100);

        return {
          id: budget.id,
          categoryId: budget.categoryId,
          name: budget.name,
          amount,
          spent,
          remaining: Math.max(0, amount - spent),
          percentUsed,
          thresholdPercent: budget.thresholdPercent,
          category: budget.category,
        };
      })
      .filter((budget) => budget.percentUsed >= budget.thresholdPercent)
      .sort((a, b) => b.percentUsed - a.percentUsed)
      .slice(0, 5);
  }

  async insights(user: RequestUser, query: DashboardMonthQueryDto) {
    const [overview, hotBudgets] = await Promise.all([
      this.overview(user, query),
      this.hotBudgets(user, query),
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
        message: `Net cashflow is ${overview.netCashflow.toLocaleString('vi-VN')} VND.`,
      });
    } else {
      insights.push({
        type: 'NEGATIVE_CASHFLOW',
        severity: 'WARNING',
        title: 'Negative cashflow',
        message: `Spending exceeds income by ${Math.abs(overview.netCashflow).toLocaleString('vi-VN')} VND.`,
      });
    }

    for (const budget of hotBudgets.slice(0, 2)) {
      insights.push({
        type: 'HOT_BUDGET',
        severity: budget.percentUsed > 100 ? 'CRITICAL' : 'WARNING',
        title: `${budget.name} used ${budget.percentUsed}% of budget`,
        message: `Spent ${budget.spent.toLocaleString('vi-VN')} / ${budget.amount.toLocaleString('vi-VN')} VND.`,
      });
    }

    return insights;
  }
}
