import type { UserMonth } from '../../common/finance/financial-period-policy';
import type { TotalsSummary } from '../../common/finance/financial-summary.query';
import {
  toTransactionResponse,
  TransactionWithRelations,
} from '../transactions/transactions.mapper';

export const toMonthlySummaryResponse = (input: {
  month: UserMonth;
  totals: TotalsSummary;
  recentTransactions: TransactionWithRelations[];
}) => ({
  month: input.month.key,
  currency: input.totals.currency,
  income: input.totals.income,
  expense: input.totals.expense,
  netCashflow: input.totals.netCashflow,
  savingsRate:
    input.totals.income > 0
      ? input.totals.netCashflow / input.totals.income
      : null,
  transactionCount: input.totals.transactionCount,
  recentTransactions: input.recentTransactions.map(toTransactionResponse),
  currencies: input.totals.currencies,
  periodStart: input.month.from.toISOString(),
  periodEnd: input.month.to.toISOString(),
});
