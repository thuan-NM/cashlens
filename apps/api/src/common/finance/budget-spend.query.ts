import { BudgetPeriod, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  EXPENSE_DIRECTIONS,
  PeriodSettings,
  TimeRange,
  UserMonth,
  eligibleTransactionWhere,
  localDateKey,
  normalizeCurrency,
  startOfLocalDay,
  toDecimal,
  userMonthContaining,
} from './financial-period-policy';

/**
 * Budget period instances and the shared budget spend aggregate (BUDGET-002,
 * BUDGET-005). Used by the budgets API, the dashboard's hot budgets, and the
 * alert inputs, so none of those modules imports another (data-model
 * "Budget period instances").
 *
 * - Budget dates are user-local calendar dates with an inclusive end:
 *   active from `startsAt`'s local date at 00:00 until the day after
 *   `endsAt`'s local date at 00:00 (exclusive), unbounded without an end.
 * - A MONTHLY instance is a user month; it exists only when it overlaps the
 *   active range, and usage counts the overlap. Other periods have no
 *   instance (alerts cover MONTHLY budgets only).
 * - Spend is eligible (TX-003) EXPENSE in the budget's currency, matched with
 *   `normalizeCurrency`, never summed across currencies. A category budget
 *   counts its category; an all-categories budget counts every expense,
 *   uncategorized included, except categories excluded from budgets.
 */

export type BudgetDates = { startsAt: Date; endsAt: Date | null };

export type BudgetPeriodInstance = {
  /** Local ISO date of the instance start: the condition-key component. */
  key: string;
  start: Date;
  end: Date;
  /** The instance clipped to the budget's active range. */
  usage: TimeRange;
};

export type MonthlyInstanceResult =
  | { supported: false }
  | { supported: true; instance: BudgetPeriodInstance | null };

/** The calendar date after `date` (`YYYY-MM-DD`). */
const nextDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(0);
  next.setUTCFullYear(year, month - 1, day + 1);
  return next.toISOString().slice(0, 10);
};

/**
 * The calendar date a stored budget date stands for. A date-only value
 * (`YYYY-MM-DD`, as the budgets page sends) is stored at UTC midnight and is
 * that date in every time zone; any other instant is read in the user's time
 * zone. Without this, a date-only value would fall on the previous day west
 * of UTC (review finding).
 */
const budgetDateKey = (stored: Date, timeZone: string) =>
  stored.getTime() % 86_400_000 === 0
    ? stored.toISOString().slice(0, 10)
    : localDateKey(stored, timeZone);

export const budgetActiveRange = (
  budget: BudgetDates,
  timeZone: string,
): { from: Date; until: Date | null } => ({
  from: startOfLocalDay(budgetDateKey(budget.startsAt, timeZone), timeZone),
  until: budget.endsAt
    ? startOfLocalDay(
        nextDate(budgetDateKey(budget.endsAt, timeZone)),
        timeZone,
      )
    : null,
});

export const monthlyInstanceForMonth = (
  budget: BudgetDates & { period: BudgetPeriod },
  month: UserMonth,
  settings: PeriodSettings,
): MonthlyInstanceResult => {
  if (budget.period !== BudgetPeriod.MONTHLY) return { supported: false };
  const active = budgetActiveRange(budget, settings.timeZone);
  const overlaps =
    active.from < month.to &&
    (active.until === null || active.until > month.from);
  if (!overlaps) return { supported: true, instance: null };
  return {
    supported: true,
    instance: {
      key: month.startDate,
      start: month.from,
      end: month.to,
      usage: {
        from: active.from > month.from ? active.from : month.from,
        to: active.until && active.until < month.to ? active.until : month.to,
      },
    },
  };
};

/** The MONTHLY instance containing `at` (the evaluated instant). */
export const monthlyInstanceAt = (
  budget: BudgetDates & { period: BudgetPeriod },
  at: Date,
  settings: PeriodSettings,
): MonthlyInstanceResult =>
  monthlyInstanceForMonth(budget, userMonthContaining(at, settings), settings);

export type BudgetSpendScope = {
  id: string;
  categoryId: string | null;
  currency: string;
  range: TimeRange;
};

export type BudgetSpendDb = Pick<
  PrismaService,
  'transaction' | 'transactionCategory'
>;

/** Spend per scope id, exact; 0 for a scope with no eligible expense. */
export async function budgetSpend(
  db: BudgetSpendDb,
  userId: string,
  scopes: BudgetSpendScope[],
): Promise<Map<string, Prisma.Decimal>> {
  const spend = new Map<string, Prisma.Decimal>(
    scopes.map((scope) => [scope.id, toDecimal(0)]),
  );
  if (!scopes.length) return spend;

  const excluded = scopes.some((scope) => scope.categoryId === null)
    ? new Set(
        (
          await db.transactionCategory.findMany({
            where: {
              excludeFromBudget: true,
              OR: [{ userId: null }, { userId }],
            },
            select: { id: true },
          })
        ).map((category) => category.id),
      )
    : new Set<string>();

  const byRange = new Map<string, BudgetSpendScope[]>();
  for (const scope of scopes) {
    const key = `${scope.range.from.toISOString()}|${scope.range.to.toISOString()}`;
    byRange.set(key, [...(byRange.get(key) ?? []), scope]);
  }

  for (const group of byRange.values()) {
    const { range } = group[0];
    if (range.from >= range.to) continue;
    const rows = await db.transaction.groupBy({
      by: ['categoryId', 'currency'],
      where: {
        AND: [
          eligibleTransactionWhere(userId, range),
          { direction: { in: EXPENSE_DIRECTIONS } },
        ],
      },
      _sum: { amount: true },
    });
    for (const scope of group) {
      const currency = normalizeCurrency(scope.currency);
      let total = toDecimal(0);
      for (const row of rows) {
        if (normalizeCurrency(row.currency) !== currency) continue;
        const counts =
          scope.categoryId === null
            ? row.categoryId === null || !excluded.has(row.categoryId)
            : row.categoryId === scope.categoryId;
        if (counts) total = total.plus(toDecimal(row._sum.amount));
      }
      spend.set(scope.id, total);
    }
  }
  return spend;
}
