import { Prisma, TransactionDirection } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  CASHFLOW_DIRECTIONS,
  PeriodSettings,
  UserMonth,
  eligibleTransactionWhere,
  isInRange,
  normalizeCurrency,
  shiftMonthKey,
  toDecimal,
  userMonthContaining,
  userMonthsEndingAt,
} from './financial-period-policy';
import { loadFinancialContext } from './financial-summary.query';

/**
 * Completed-month net cashflow of one currency: the observation input of goal
 * feasibility (GOAL-003) and of the goal-risk and cashflow-risk alerts. It
 * lives in common/finance so alert inputs can reuse it without importing
 * GoalsModule (research.md "Alert orchestration dependency direction").
 *
 * - History starts in the user month of the user's earliest eligible (TX-003:
 *   POSTED and not a duplicate, whatever the direction) record in the
 *   currency.
 * - Observation months are the completed user months from that start, the
 *   current month excluded, keeping at most the 3 most recent. A month with
 *   no eligible income or expense has a net of 0.
 * - A month's net is eligible INCOME minus EXPENSE in the currency. Transfers
 *   and adjustments never count. Stored codes that differ only in case or
 *   padding are the same currency (`normalizeCurrency`). Amounts stay exact
 *   decimals.
 */

/** At most this many completed months are observed (GOAL-003). */
export const OBSERVATION_MONTHS_MAX = 3;

export type ObservationMonth = { key: string; net: Prisma.Decimal };

export type CompletedMonthCashflow = {
  currency: string;
  /** The user month of the earliest eligible record in the currency. */
  historyStartMonth: string | null;
  /** Oldest first; empty months carry a net of 0. */
  months: ObservationMonth[];
};

type CashflowDb = Pick<PrismaService, 'transaction' | 'user'>;

/**
 * The observation months for a history that starts at `historyStart`: of the
 * 3 most recent completed user months, those that end after it. That is the
 * start's own month and every later one, and none when the history starts in
 * the current month or later.
 */
export function observationWindow(
  historyStart: Date | null,
  now: Date,
  settings: PeriodSettings,
): UserMonth[] {
  if (!historyStart) return [];
  const lastCompleted = shiftMonthKey(
    userMonthContaining(now, settings).key,
    -1,
  );
  return userMonthsEndingAt(
    lastCompleted,
    OBSERVATION_MONTHS_MAX,
    settings,
  ).filter((month) => month.to > historyStart);
}

/** The history start's user month; null outside the supported calendar. */
const historyStartMonthOf = (instant: Date, settings: PeriodSettings) => {
  try {
    return userMonthContaining(instant, settings).key;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
};

/**
 * The observation of `currency` at `now`. `settings` are the account's period
 * settings; they are read from the account when not given.
 */
export async function completedMonthCashflow(
  db: CashflowDb,
  userId: string,
  currency: string,
  now: Date,
  settings?: PeriodSettings,
): Promise<CompletedMonthCashflow> {
  const period = settings ?? (await loadFinancialContext(db, userId)).settings;
  const code = normalizeCurrency(currency);
  // Stored codes are matched in code with the shared normalization, so codes
  // that differ only in case or padding are one currency (data-model
  // "Financial period policy") and a free-form goal currency is never a
  // database pattern.
  const inCurrency = (stored: string) => normalizeCurrency(stored) === code;

  const starts = await db.transaction.groupBy({
    by: ['currency'],
    where: eligibleTransactionWhere(userId),
    _min: { transactionTime: true },
  });
  const historyStart = starts
    .filter((group) => inCurrency(group.currency))
    .map((group) => group._min.transactionTime)
    .reduce<Date | null>(
      (earliest, time) =>
        time && (!earliest || time < earliest) ? time : earliest,
      null,
    );
  const window = observationWindow(historyStart, now, period);

  const nets = new Map(window.map((month) => [month.key, toDecimal(0)]));
  if (window.length) {
    const rows = await db.transaction.findMany({
      where: {
        AND: [
          eligibleTransactionWhere(userId, {
            from: window[0].from,
            to: window[window.length - 1].to,
          }),
          { direction: { in: CASHFLOW_DIRECTIONS } },
        ],
      },
      select: {
        amount: true,
        currency: true,
        direction: true,
        transactionTime: true,
      },
    });
    for (const row of rows) {
      if (!inCurrency(row.currency)) continue;
      const month = window.find((item) => isInRange(row.transactionTime, item));
      if (!month) continue;
      const net = nets.get(month.key)!;
      nets.set(
        month.key,
        row.direction === TransactionDirection.INCOME
          ? net.plus(row.amount)
          : net.minus(row.amount),
      );
    }
  }

  return {
    currency: code,
    historyStartMonth: historyStart
      ? historyStartMonthOf(historyStart, period)
      : null,
    months: window.map((month) => ({
      key: month.key,
      net: nets.get(month.key)!,
    })),
  };
}
