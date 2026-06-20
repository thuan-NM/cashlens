import { Prisma } from '@prisma/client';
import { toTransactionResponse, TransactionWithRelations } from '../transactions/transactions.mapper';

export const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? 0 : Number(value.toString());

export const toMonthlySummaryResponse = (input: {
  month: string;
  income: number;
  expense: number;
  transactionCount: number;
  recentTransactions: TransactionWithRelations[];
}) => {
  const netCashflow = input.income - input.expense;

  return {
    month: input.month,
    income: input.income,
    expense: input.expense,
    netCashflow,
    savingsRate: input.income > 0 ? netCashflow / input.income : null,
    transactionCount: input.transactionCount,
    recentTransactions: input.recentTransactions.map(toTransactionResponse),
  };
};
