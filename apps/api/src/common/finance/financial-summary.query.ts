import { Prisma, TransactionDirection } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  CASHFLOW_DIRECTIONS,
  CurrencyTotals,
  PeriodSettings,
  TimeRange,
  eligibleTransactionWhere,
  localDateKey,
  normalizeCurrency,
  resolvePeriodSettings,
  toDecimal,
  totalsByCurrency,
  totalsForCurrency,
} from './financial-period-policy';

/**
 * Prisma-backed aggregates over the shared policy (financial-period-policy),
 * used by transaction lists, dashboard, and analytics so every total applies
 * the same eligibility, period, transfer, and currency rules. Each helper
 * builds its own eligibility predicate; callers only narrow it.
 */

type FinanceDb = Pick<PrismaService, 'transaction' | 'user'>;

export const DEFAULT_BASE_CURRENCY = 'VND';

export type FinancialContext = {
  settings: PeriodSettings;
  baseCurrency: string;
};

/** Base-currency totals plus every currency group, never summed across. */
export type TotalsSummary = Omit<CurrencyTotals, 'currency'> & {
  currency: string;
  currencies: CurrencyTotals[];
};

export type CategoryAmountRow = {
  categoryId: string | null;
  direction: TransactionDirection;
  currency: string;
  amount: number;
  count: number;
};

export type CashflowPoint = {
  currency: string;
  income: number;
  expense: number;
  netCashflow: number;
};

/** Timezone, month-start day, and base currency of the account. */
export async function loadFinancialContext(
  db: FinanceDb,
  userId: string,
): Promise<FinancialContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      timezone: true,
      baseCurrency: true,
      settings: { select: { defaultMonthStartDay: true } },
    },
  });
  return {
    settings: resolvePeriodSettings({
      timezone: user?.timezone,
      defaultMonthStartDay: user?.settings?.defaultMonthStartDay,
    }),
    baseCurrency: normalizeCurrency(
      user?.baseCurrency || DEFAULT_BASE_CURRENCY,
    ),
  };
}

const eligible = (
  userId: string,
  range?: TimeRange,
  narrow?: Prisma.TransactionWhereInput,
): Prisma.TransactionWhereInput =>
  narrow
    ? { AND: [eligibleTransactionWhere(userId, range), narrow] }
    : eligibleTransactionWhere(userId, range);

/** The groupBy behind every total; batchable inside `$transaction`. */
export const eligibleTotalsQuery = (
  db: FinanceDb,
  userId: string,
  options: { range?: TimeRange; where?: Prisma.TransactionWhereInput } = {},
) =>
  db.transaction.groupBy({
    by: ['currency', 'direction'],
    where: eligible(userId, options.range, options.where),
    _sum: { amount: true },
    _count: { _all: true },
  });

export const toTotalsSummary = (
  rows: Awaited<ReturnType<typeof eligibleTotalsQuery>>,
  baseCurrency: string,
): TotalsSummary => {
  const currencies = totalsByCurrency(
    rows.map((row) => ({
      currency: row.currency,
      direction: row.direction,
      amount: row._sum.amount,
      count: row._count._all,
    })),
  );
  const base = totalsForCurrency(currencies, baseCurrency);
  return {
    currency: baseCurrency,
    income: base.income,
    expense: base.expense,
    netCashflow: base.netCashflow,
    // A record count is not money, so it spans every currency.
    transactionCount: currencies.reduce(
      (sum, entry) => sum + entry.transactionCount,
      0,
    ),
    currencies,
  };
};

export async function eligibleTotals(
  db: FinanceDb,
  userId: string,
  baseCurrency: string,
  options: { range?: TimeRange; where?: Prisma.TransactionWhereInput } = {},
): Promise<TotalsSummary> {
  return toTotalsSummary(
    await eligibleTotalsQuery(db, userId, options),
    baseCurrency,
  );
}

/**
 * Eligible amounts per category, direction, and currency. Uncategorized rows
 * form their own group (`categoryId: null`), so the groups of one direction
 * and currency always add up to that total.
 */
export async function eligibleAmountsByCategory(
  db: FinanceDb,
  userId: string,
  range: TimeRange,
  directions?: TransactionDirection[],
): Promise<CategoryAmountRow[]> {
  const rows = await db.transaction.groupBy({
    by: ['categoryId', 'direction', 'currency'],
    where: eligible(
      userId,
      range,
      directions ? { direction: { in: directions } } : undefined,
    ),
    _sum: { amount: true },
    _count: { _all: true },
  });
  // Rows whose stored codes differ only in case form one currency group.
  const groups = new Map<
    string,
    Omit<CategoryAmountRow, 'amount'> & { amount: Prisma.Decimal }
  >();
  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    const key = `${row.categoryId ?? ''}|${row.direction}|${currency}`;
    const group = groups.get(key) ?? {
      categoryId: row.categoryId,
      direction: row.direction,
      currency,
      amount: toDecimal(0),
      count: 0,
    };
    group.amount = group.amount.plus(toDecimal(row._sum.amount));
    group.count += row._count._all;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    amount: group.amount.toNumber(),
  }));
}

/** Deterministic order: base currency first, then larger amounts, then id. */
export const compareCategoryRows =
  (baseCurrency: string) =>
  (a: CategoryAmountRow, b: CategoryAmountRow): number => {
    if (a.currency !== b.currency) {
      if (a.currency === baseCurrency) return -1;
      if (b.currency === baseCurrency) return 1;
      return a.currency < b.currency ? -1 : 1;
    }
    if (a.direction !== b.direction) {
      return a.direction < b.direction ? -1 : 1;
    }
    if (a.amount !== b.amount) {
      return b.amount - a.amount;
    }
    // Uncategorized last within an equal amount, then by category id.
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return a.categoryId < b.categoryId ? -1 : 1;
  };

/**
 * Eligible income and expense of one currency, bucketed by a key derived from
 * each record's instant (a user month or a local date).
 */
export async function eligibleCashflowBuckets(
  db: FinanceDb,
  userId: string,
  range: TimeRange,
  currency: string,
  bucketOf: (instant: Date) => string | null,
): Promise<Map<string, CashflowPoint>> {
  const rows = await db.transaction.findMany({
    where: eligible(userId, range, {
      currency: { equals: currency, mode: 'insensitive' },
      direction: { in: CASHFLOW_DIRECTIONS },
    }),
    select: { amount: true, direction: true, transactionTime: true },
  });
  const sums = new Map<
    string,
    { income: Prisma.Decimal; expense: Prisma.Decimal }
  >();
  for (const row of rows) {
    const key = bucketOf(row.transactionTime);
    if (key === null) continue;
    const sum = sums.get(key) ?? {
      income: toDecimal(0),
      expense: toDecimal(0),
    };
    if (row.direction === TransactionDirection.INCOME) {
      sum.income = sum.income.plus(row.amount);
    } else {
      sum.expense = sum.expense.plus(row.amount);
    }
    sums.set(key, sum);
  }
  return new Map(
    [...sums.entries()].map(([key, sum]) => [
      key,
      {
        currency,
        income: sum.income.toNumber(),
        expense: sum.expense.toNumber(),
        netCashflow: sum.income.minus(sum.expense).toNumber(),
      },
    ]),
  );
}

export const emptyCashflowPoint = (currency: string): CashflowPoint => ({
  currency,
  income: 0,
  expense: 0,
  netCashflow: 0,
});

/** Buckets by the user's local calendar date (`YYYY-MM-DD`). */
export const byLocalDate = (timeZone: string) => (instant: Date) =>
  localDateKey(instant, timeZone);
