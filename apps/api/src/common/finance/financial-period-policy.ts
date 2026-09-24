import {
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';

/**
 * The one financial policy shared by transaction lists, dashboard, analytics,
 * budgets, alerts, and goals (TX-003, DASH-001–DASH-003, DATA-004).
 *
 * Eligibility: only POSTED, non-duplicate records count. Pending,
 * needs-review, ignored, soft-deleted, and confirmed-duplicate records never
 * contribute, whatever their direction.
 *
 * Treatment: INCOME and EXPENSE form the totals. TRANSFER_IN/TRANSFER_OUT are
 * shown in lists but excluded from income, expense, and net; ADJUSTMENT is
 * neither income nor expense and is excluded the same way. Amounts are summed
 * with exact decimals, and currencies are always kept in separate groups.
 *
 * Periods: a user month starts on `monthStartDay` at the start of that local
 * day in the user's IANA timezone and ends, exclusive, where the next one
 * starts. It is labelled by the local year and month of its first day, so with
 * month-start day 25 the month containing 2026-09-23 is "2026-08" and starts
 * 2026-08-25. A local day starts at its earliest instant: when daylight saving
 * skips midnight, at the first instant after the gap; when midnight occurs
 * twice, at the first occurrence.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const DEFAULT_MONTH_START_DAY = 1;
export const MAX_MONTH_START_DAY = 28;
/** `YYYY-MM` for 1900-01 through 2099-12, the supported calendar range. */
export const MONTH_KEY_PATTERN = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

export type PeriodSettings = { timeZone: string; monthStartDay: number };
/** Half-open `[from, to)` instant range. */
export type TimeRange = { from: Date; to: Date };
/** A user month: its `YYYY-MM` label, local first day, and UTC range. */
export type UserMonth = TimeRange & { key: string; startDate: string };
export type FinancialTreatment = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'EXCLUDED';
export type EligibilityFields = {
  status: TransactionStatus;
  isDuplicate: boolean;
};
export type LedgerRow = EligibilityFields & {
  direction: TransactionDirection;
  currency: string;
  amount: Prisma.Decimal | number | string;
};
/** One database group of already-eligible rows. */
export type DirectionSumRow = {
  currency: string;
  direction: TransactionDirection;
  amount: Prisma.Decimal | number | string | null;
  count: number;
};
export type CurrencyTotals = {
  currency: string;
  income: number;
  expense: number;
  netCashflow: number;
  /** Eligible records of every direction, transfers included. */
  transactionCount: number;
};

export const INCOME_DIRECTIONS: TransactionDirection[] = [
  TransactionDirection.INCOME,
];
export const EXPENSE_DIRECTIONS: TransactionDirection[] = [
  TransactionDirection.EXPENSE,
];
export const CASHFLOW_DIRECTIONS: TransactionDirection[] = [
  TransactionDirection.INCOME,
  TransactionDirection.EXPENSE,
];

// --- eligibility and treatment -------------------------------------------------

export const isEligibleTransaction = (row: EligibilityFields): boolean =>
  row.status === TransactionStatus.POSTED && !row.isDuplicate;

export const treatmentOf = (
  row: EligibilityFields & { direction: TransactionDirection },
): FinancialTreatment => {
  if (!isEligibleTransaction(row)) {
    return 'EXCLUDED';
  }
  switch (row.direction) {
    case TransactionDirection.INCOME:
      return 'INCOME';
    case TransactionDirection.EXPENSE:
      return 'EXPENSE';
    case TransactionDirection.TRANSFER_IN:
    case TransactionDirection.TRANSFER_OUT:
      return 'TRANSFER';
    default:
      return 'EXCLUDED';
  }
};

/** Rows that feed totals: the database form of `isEligibleTransaction`. */
export const eligibleTransactionWhere = (
  userId: string,
  range?: TimeRange,
): Prisma.TransactionWhereInput => ({
  userId,
  status: TransactionStatus.POSTED,
  isDuplicate: false,
  ...(range ? { transactionTime: { gte: range.from, lt: range.to } } : {}),
});

/** Rows a user may see in lists: everything owned except soft-deleted rows. */
export const visibleTransactionWhere = (userId: string) =>
  ({
    userId,
    status: { not: TransactionStatus.DELETED },
  }) satisfies Prisma.TransactionWhereInput;

// --- totals --------------------------------------------------------------------

export const toDecimal = (
  value: Prisma.Decimal | number | string | null | undefined,
) => new Prisma.Decimal(value ?? 0);

/** One currency code whatever its stored case or padding ("vnd " is "VND"). */
export const normalizeCurrency = (currency: string) =>
  currency.trim().toUpperCase();

/** Folds per-direction sums of eligible rows into per-currency totals. */
export const totalsByCurrency = (rows: DirectionSumRow[]): CurrencyTotals[] => {
  const groups = new Map<
    string,
    { income: Prisma.Decimal; expense: Prisma.Decimal; count: number }
  >();
  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    const group = groups.get(currency) ?? {
      income: toDecimal(0),
      expense: toDecimal(0),
      count: 0,
    };
    if (row.direction === TransactionDirection.INCOME) {
      group.income = group.income.plus(toDecimal(row.amount));
    } else if (row.direction === TransactionDirection.EXPENSE) {
      group.expense = group.expense.plus(toDecimal(row.amount));
    }
    group.count += row.count;
    groups.set(currency, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, group]) => ({
      currency,
      income: group.income.toNumber(),
      expense: group.expense.toNumber(),
      netCashflow: group.income.minus(group.expense).toNumber(),
      transactionCount: group.count,
    }));
};

/** The in-memory form: filters eligibility, then totals per currency. */
export const summarizeTransactions = (rows: LedgerRow[]): CurrencyTotals[] =>
  totalsByCurrency(
    rows.filter(isEligibleTransaction).map((row) => ({
      currency: row.currency,
      direction: row.direction,
      amount: row.amount,
      count: 1,
    })),
  );

export const totalsForCurrency = (
  totals: CurrencyTotals[],
  currency: string,
): CurrencyTotals =>
  totals.find((entry) => entry.currency === currency) ?? {
    currency,
    income: 0,
    expense: 0,
    netCashflow: 0,
    transactionCount: 0,
  };

/**
 * Whole-percent savings rate of one currency: net ÷ income × 100, rounded
 * half up; 0 when there is no income. It is negative when spending exceeds
 * income.
 */
export const savingRatePercent = (income: number, netCashflow: number) => {
  if (income === 0) {
    return 0;
  }
  const rate = Math.round(
    toDecimal(netCashflow).div(income).times(100).toNumber(),
  );
  return rate === 0 ? 0 : rate;
};

export const isInRange = (instant: Date, range: TimeRange): boolean =>
  instant.getTime() >= range.from.getTime() &&
  instant.getTime() < range.to.getTime();

// --- settings and month keys ---------------------------------------------------

// Bounded: stored timezones are user input, and Intl accepts endless case
// variants of one zone, so an unbounded cache could exhaust memory.
const MAX_CACHED_FORMATTERS = 256;
const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    const oldest = formatters.keys().next();
    if (formatters.size >= MAX_CACHED_FORMATTERS && !oldest.done) {
      formatters.delete(oldest.value);
    }
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

export const isValidTimeZone = (timeZone: string): boolean => {
  if (typeof timeZone !== 'string' || !timeZone) {
    return false;
  }
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
};

/**
 * Period settings from stored account values. A stored timezone that is not a
 * valid IANA zone, or a month-start day outside 1–28, falls back to the
 * account defaults (`Asia/Ho_Chi_Minh`, day 1) instead of failing the request.
 */
export const resolvePeriodSettings = (input: {
  timezone?: string | null;
  defaultMonthStartDay?: number | null;
}): PeriodSettings => {
  const day = input.defaultMonthStartDay;
  return {
    timeZone:
      input.timezone && isValidTimeZone(input.timezone)
        ? input.timezone
        : DEFAULT_TIME_ZONE,
    monthStartDay:
      Number.isInteger(day) && day! >= 1 && day! <= MAX_MONTH_START_DAY
        ? day!
        : DEFAULT_MONTH_START_DAY,
  };
};

export const parseMonthKey = (
  key: string,
): { year: number; month: number } | null => {
  if (typeof key !== 'string' || !MONTH_KEY_PATTERN.test(key)) {
    return null;
  }
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
};

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

const monthKeyOf = (year: number, month: number) =>
  `${pad(year, 4)}-${pad(month)}`;

/**
 * Moves a month key by whole months. It accepts any four-digit year, since
 * windows are computed around keys at the edge of the supported range.
 */
export const shiftMonthKey = (key: string, offset: number): string => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!match) {
    throw new RangeError(`Invalid month key: ${key}`);
  }
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + offset;
  return monthKeyOf(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
};

// --- local time ------------------------------------------------------------------

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const localParts = (epochMs: number, timeZone: string): LocalParts => {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const dateKeyOf = (parts: Pick<LocalParts, 'year' | 'month' | 'day'>) =>
  `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;

export const localDateKey = (instant: Date, timeZone: string): string =>
  dateKeyOf(localParts(instant.getTime(), timeZone));

/** Date.UTC without its remapping of years 0–99 onto 1900–1999. */
const utcMs = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
};

/** Local wall-clock time of an instant, expressed as if it were UTC. */
const wallClockMs = (epochMs: number, timeZone: string) => {
  const parts = localParts(epochMs, timeZone);
  return utcMs(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
};

/** UTC offset (local minus UTC) in effect at an instant, to the second. */
const offsetMs = (epochMs: number, timeZone: string) => {
  const whole = Math.floor(epochMs / 1000) * 1000;
  return wallClockMs(whole, timeZone) - whole;
};

const HOUR = 3_600_000;

/** The earliest instant whose local date is `date` (`YYYY-MM-DD`). */
export const startOfLocalDay = (date: string, timeZone: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Invalid local date: ${date}`);
  }
  const wallMidnight = utcMs(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );

  // Fast path: midnight exists. Try every offset in effect around that day and
  // keep the earliest instant that is exactly local midnight on that date.
  const offsets = new Set(
    [-48, -24, 0, 24, 48].map((hours) =>
      offsetMs(wallMidnight + hours * HOUR, timeZone),
    ),
  );
  const midnights = [...offsets]
    .map((offset) => wallMidnight - offset)
    .filter((candidate) => wallClockMs(candidate, timeZone) === wallMidnight);
  if (midnights.length) {
    return new Date(Math.min(...midnights));
  }

  // Midnight was skipped: the day starts at the end of the gap, the first
  // second whose local date is `date`.
  let low = Math.floor((wallMidnight - 50 * HOUR) / 1000);
  let high = Math.ceil((wallMidnight + 50 * HOUR) / 1000);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateKeyOf(localParts(middle * 1000, timeZone)) >= date) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return new Date(low * 1000);
};

// --- user months -------------------------------------------------------------------

const monthStart = (key: string, settings: PeriodSettings) =>
  startOfLocalDay(`${key}-${pad(settings.monthStartDay)}`, settings.timeZone);

export const userMonthForKey = (
  key: string,
  settings: PeriodSettings,
): UserMonth => {
  if (!parseMonthKey(key)) {
    throw new RangeError(`Invalid month key: ${key}`);
  }
  return {
    key,
    startDate: `${key}-${pad(settings.monthStartDay)}`,
    from: monthStart(key, settings),
    to: monthStart(shiftMonthKey(key, 1), settings),
  };
};

export const userMonthContaining = (
  instant: Date,
  settings: PeriodSettings,
): UserMonth => {
  const local = localParts(instant.getTime(), settings.timeZone);
  const calendarKey = monthKeyOf(local.year, local.month);
  let month = userMonthForKey(
    local.day >= settings.monthStartDay
      ? calendarKey
      : shiftMonthKey(calendarKey, -1),
    settings,
  );
  // The ranges are authoritative: an instant in a repeated local hour can read
  // as the previous date yet already lie inside the next month's range.
  for (let step = 0; step < 3 && instant < month.from; step++) {
    month = userMonthForKey(shiftMonthKey(month.key, -1), settings);
  }
  for (let step = 0; step < 3 && instant >= month.to; step++) {
    month = userMonthForKey(shiftMonthKey(month.key, 1), settings);
  }
  return month;
};

/** `count` consecutive months, oldest first, whose last month is `lastKey`. */
export const userMonthsEndingAt = (
  lastKey: string,
  count: number,
  settings: PeriodSettings,
): UserMonth[] => {
  if (count <= 0) {
    return [];
  }
  const keys = Array.from({ length: count + 1 }, (_, index) =>
    shiftMonthKey(lastKey, index - count + 1),
  );
  const starts = keys.map((key) => monthStart(key, settings));
  return keys.slice(0, count).map((key, index) => ({
    key,
    startDate: `${key}-${pad(settings.monthStartDay)}`,
    from: starts[index],
    to: starts[index + 1],
  }));
};

/** The `count` most recent months, oldest first, ending with the current one. */
export const recentUserMonths = (
  count: number,
  now: Date,
  settings: PeriodSettings,
): UserMonth[] =>
  userMonthsEndingAt(userMonthContaining(now, settings).key, count, settings);

/** The `count` most recent completed months, oldest first (current excluded). */
export const completedUserMonths = (
  count: number,
  now: Date,
  settings: PeriodSettings,
): UserMonth[] =>
  userMonthsEndingAt(
    shiftMonthKey(userMonthContaining(now, settings).key, -1),
    count,
    settings,
  );

/** One range spanning the `count` most recent completed months. */
export const completedMonthsRange = (
  count: number,
  now: Date,
  settings: PeriodSettings,
): TimeRange => {
  const current = userMonthContaining(now, settings);
  if (count <= 0) {
    return { from: current.from, to: current.from };
  }
  return {
    from: userMonthForKey(shiftMonthKey(current.key, -count), settings).from,
    to: current.from,
  };
};
