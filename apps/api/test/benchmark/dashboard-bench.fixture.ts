/**
 * Deterministic data set of the DASH-004 reference dashboard benchmark
 * (research.md "Dashboard benchmark (DASH-004, SC-010)", T036).
 *
 * - Seed 20260923 drives a small seeded PRNG (mulberry32), so the same seed
 *   and anchor always yield byte-identical records and expected totals.
 * - One synthetic user, bench@cashlens.test: timezone Asia/Ho_Chi_Minh,
 *   month-start day 1, base currency VND.
 * - 13 user months: the 12 completed months before the anchor's month plus
 *   the anchor's (current) month. Each month holds exactly 230 transactions:
 *   185 VND expenses, 5 USD expenses, 20 VND incomes, 10 VND transfers
 *   (5 TRANSFER_OUT + 5 TRANSFER_IN), 4 ignored, 3 duplicates, 3 soft-deleted,
 *   for 2,990 in total. Current-month rows are spread over the elapsed part of
 *   the month, up to the end of the anchor day.
 * - 20 categories (15 expense, 5 income), 3 accounts (bank, e-wallet, cash),
 *   and 10 active MONTHLY budgets on distinct expense categories.
 *
 * The generator is pure: it never reads the clock (the anchor is an argument)
 * and imports nothing from the application at runtime. Every month draws the
 * same number of random values whatever its length, so the anchor's day only
 * moves current-month timestamps: the expected totals depend on the seed and
 * the anchor's month alone, and any day of the seeding month verifies. Its expected
 * current-month totals are computed here, independently of the production
 * financial policy, in integer hundredths (the scale of the Decimal(18,2)
 * `amount` column): eligible means POSTED and not a duplicate, in any
 * direction; only INCOME and EXPENSE form income, expense, and net; each
 * currency is its own group.
 *
 * Asia/Ho_Chi_Minh has been a fixed UTC+07:00 zone without daylight saving
 * since 1975, so month and day boundaries are computed with that fixed offset
 * instead of a timezone database.
 *
 * Record shapes are plain JSON matching the Prisma createMany inputs; the
 * seeder (dashboard-benchmark.ts) type-checks them against Prisma.
 */

export const BENCH_SEED = 20260923;
export const BENCH_EMAIL = 'bench@cashlens.test';
export const BENCH_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** Fixed offset of Asia/Ho_Chi_Minh (no DST): local = UTC + 7 h. */
export const BENCH_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
export const BENCH_MONTH_START_DAY = 1;
export const BENCH_BASE_CURRENCY = 'VND';
export const BENCH_FOREIGN_CURRENCY = 'USD';
/** 12 completed months plus the current one. */
export const BENCH_MONTH_COUNT = 13;

/** The DASH-004 per-month mix. */
export const BENCH_MONTH_MIX = {
  vndExpenses: 185,
  usdExpenses: 5,
  incomes: 20,
  transfersOut: 5,
  transfersIn: 5,
  ignored: 4,
  duplicates: 3,
  deleted: 3,
} as const;
export const BENCH_TRANSACTIONS_PER_MONTH = Object.values(
  BENCH_MONTH_MIX,
).reduce((sum, count) => sum + count, 0);

const EXPENSE_CATEGORIES = [
  'Food & Drinks',
  'Groceries',
  'Transport',
  'Fuel',
  'Housing',
  'Utilities',
  'Phone & Internet',
  'Health',
  'Education',
  'Shopping',
  'Entertainment',
  'Travel',
  'Personal Care',
  'Gifts & Donations',
  'Insurance',
];
const INCOME_CATEGORIES = [
  'Salary',
  'Bonus',
  'Freelance',
  'Interest',
  'Other Income',
];
/** Budgets cover the first ten expense categories. */
const BUDGETED_CATEGORY_COUNT = 10;

// --- record shapes (plain JSON, ready for Prisma createMany) ------------------

export type BenchUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'USER';
  status: 'ACTIVE';
  timezone: string;
  locale: string;
  baseCurrency: string;
};
export type BenchSettings = {
  id: string;
  userId: string;
  defaultMonthStartDay: number;
};
export type BenchAccount = {
  id: string;
  userId: string;
  name: string;
  institutionName: string | null;
  type: 'CHECKING' | 'E_WALLET' | 'CASH';
  currency: string;
  isDefault: boolean;
  status: 'ACTIVE';
};
export type BenchCategory = {
  id: string;
  userId: string;
  name: string;
  slug: string;
  type: 'EXPENSE' | 'INCOME';
  sortOrder: number;
  status: 'ACTIVE';
};
export type BenchBudget = {
  id: string;
  userId: string;
  categoryId: string;
  name: string;
  amount: string;
  currency: string;
  period: 'MONTHLY';
  startsAt: string;
  endsAt: null;
  thresholdPercent: number;
  isActive: boolean;
};
export type BenchDirection =
  | 'INCOME'
  | 'EXPENSE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';
export type BenchStatus = 'POSTED' | 'IGNORED' | 'DELETED';
export type BenchTransaction = {
  id: string;
  userId: string;
  financialAccountId: string;
  categoryId: string | null;
  merchantName: string | null;
  description: string;
  sourceType: 'MANUAL';
  /** Decimal string with two places, e.g. "125000.00". */
  amount: string;
  currency: string;
  direction: BenchDirection;
  /** ISO 8601 instant (UTC). */
  transactionTime: string;
  status: BenchStatus;
  isDuplicate: boolean;
  duplicateOfTransactionId: string | null;
};

/** A user month of the fixture; instants are ISO 8601 UTC strings. */
export type BenchMonth = {
  key: string;
  /** First instant of the month. */
  from: string;
  /** First instant of the next month (exclusive). */
  to: string;
  /** Exclusive end of the transaction spread: `to`, or the end of the anchor day. */
  spreadTo: string;
  current: boolean;
};

export type ExpectedCurrencyTotals = {
  currency: string;
  /** Integer hundredths. */
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  /** Eligible records of every direction, transfers included. */
  eligibleCount: number;
};

/** Current-month totals in the shape GET /dashboard/overview reports. */
export type ExpectedOverview = {
  month: string;
  currency: string;
  income: number;
  expense: number;
  netCashflow: number;
  transactionCount: number;
  currencies: Array<{
    currency: string;
    income: number;
    expense: number;
    netCashflow: number;
    transactionCount: number;
  }>;
  periodStart: string;
  periodEnd: string;
  timeZone: string;
};

export type ExpectedTotals = {
  month: string;
  periodStart: string;
  periodEnd: string;
  baseCurrency: string;
  /** Every currency group, sorted by code. */
  currencies: ExpectedCurrencyTotals[];
  /** Eligible records of every currency and direction. */
  eligibleCount: number;
  /** Every current-month record, whatever its status. */
  totalCount: number;
  overview: ExpectedOverview;
};

export type DashboardBenchFixture = {
  seed: number;
  anchor: string;
  months: BenchMonth[];
  user: BenchUser;
  settings: BenchSettings;
  accounts: BenchAccount[];
  categories: BenchCategory[];
  budgets: BenchBudget[];
  transactions: BenchTransaction[];
  expected: ExpectedTotals;
};

// --- deterministic helpers ------------------------------------------------------

/** mulberry32: a small, well-known 32-bit seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A cuid-shaped (25 characters, leading "c") deterministic identifier. */
const benchId = (kind: string, n: number) =>
  `cbench${kind}${String(n).padStart(19 - kind.length, '0')}`;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Integer hundredths to a two-place decimal string. */
export const formatMinor = (minor: number): string => {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${pad(abs % 100)}`;
};

/** Two-place decimal string to integer hundredths. */
export const parseMinor = (amount: string): number => {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount);
  if (!match) {
    throw new RangeError(`Not a two-place decimal: ${amount}`);
  }
  const minor = Number(match[2]) * 100 + Number(match[3]);
  return match[1] ? -minor : minor;
};

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Parses and validates a YYYY-MM-DD anchor date. */
export function parseAnchor(anchor: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match) {
    throw new RangeError(`The anchor must be a YYYY-MM-DD date: ${anchor}`);
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`The anchor is not a calendar date: ${anchor}`);
  }
  return { year, month, day };
}

/** Today's local date in Asia/Ho_Chi_Minh (fixed UTC+07:00) at `now`. */
export const benchToday = (now: Date): string =>
  new Date(now.getTime() + BENCH_UTC_OFFSET_MS).toISOString().slice(0, 10);

/** First instant of a local day in Asia/Ho_Chi_Minh (month may overflow). */
const localDayStart = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day) - BENCH_UTC_OFFSET_MS;

/** The 13 user months ending with the anchor's month, oldest first. */
export function benchMonths(anchor: string): BenchMonth[] {
  const { year, month, day } = parseAnchor(anchor);
  const anchorDayEnd = localDayStart(year, month, day + 1);
  return Array.from({ length: BENCH_MONTH_COUNT }, (_, index) => {
    const offset = index - (BENCH_MONTH_COUNT - 1);
    const monthIndex = year * 12 + (month - 1) + offset;
    const y = Math.floor(monthIndex / 12);
    const m = (monthIndex % 12) + 1;
    const from = localDayStart(y, m, BENCH_MONTH_START_DAY);
    const to = localDayStart(y, m + 1, BENCH_MONTH_START_DAY);
    const current = offset === 0;
    return {
      key: `${pad(y, 4)}-${pad(m)}`,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      spreadTo: new Date(current ? anchorDayEnd : to).toISOString(),
      current,
    };
  });
}

// --- generator --------------------------------------------------------------------

/**
 * Builds the benchmark data set for `anchor` (the local YYYY-MM-DD date in
 * Asia/Ho_Chi_Minh whose month is the current month).
 */
export function generateDashboardBenchFixture(
  anchor: string,
  seed = BENCH_SEED,
): DashboardBenchFixture {
  const random = mulberry32(seed);
  const int = (min: number, max: number) =>
    min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];

  const months = benchMonths(anchor);
  const userId = benchId('usr', 1);

  const user: BenchUser = {
    id: userId,
    email: BENCH_EMAIL,
    fullName: 'Benchmark User',
    role: 'USER',
    status: 'ACTIVE',
    timezone: BENCH_TIME_ZONE,
    locale: 'vi-VN',
    baseCurrency: BENCH_BASE_CURRENCY,
  };
  const settings: BenchSettings = {
    id: benchId('set', 1),
    userId,
    defaultMonthStartDay: BENCH_MONTH_START_DAY,
  };

  const accounts: BenchAccount[] = [
    {
      id: benchId('acc', 1),
      userId,
      name: 'Bench Bank Checking',
      institutionName: 'Bench Bank',
      type: 'CHECKING',
      currency: BENCH_BASE_CURRENCY,
      isDefault: true,
      status: 'ACTIVE',
    },
    {
      id: benchId('acc', 2),
      userId,
      name: 'Bench E-Wallet',
      institutionName: 'Bench Wallet',
      type: 'E_WALLET',
      currency: BENCH_BASE_CURRENCY,
      isDefault: false,
      status: 'ACTIVE',
    },
    {
      id: benchId('acc', 3),
      userId,
      name: 'Bench Cash',
      institutionName: null,
      type: 'CASH',
      currency: BENCH_BASE_CURRENCY,
      isDefault: false,
      status: 'ACTIVE',
    },
  ];
  const [bank, wallet] = accounts;

  const categories: BenchCategory[] = [
    ...EXPENSE_CATEGORIES.map((name) => ({ name, type: 'EXPENSE' as const })),
    ...INCOME_CATEGORIES.map((name) => ({ name, type: 'INCOME' as const })),
  ].map((category, index) => ({
    id: benchId('cat', index + 1),
    userId,
    name: category.name,
    slug: slugify(category.name),
    type: category.type,
    sortOrder: (index + 1) * 10,
    status: 'ACTIVE',
  }));
  const expenseCategories = categories.filter((c) => c.type === 'EXPENSE');
  const incomeCategories = categories.filter((c) => c.type === 'INCOME');

  // Budgets from 6.0M to 14.0M VND per month, around the average monthly
  // spend of one category, so some of them cross their 80% threshold.
  const budgets: BenchBudget[] = expenseCategories
    .slice(0, BUDGETED_CATEGORY_COUNT)
    .map((category, index) => ({
      id: benchId('bud', index + 1),
      userId,
      categoryId: category.id,
      name: `${category.name} budget`,
      amount: formatMinor(int(12, 28) * 500_000 * 100),
      currency: BENCH_BASE_CURRENCY,
      period: 'MONTHLY',
      startsAt: months[0].from,
      endsAt: null,
      thresholdPercent: 80,
      isActive: true,
    }));

  const transactions: BenchTransaction[] = [];
  let sequence = 0;

  for (const month of months) {
    const from = Date.parse(month.from);
    const spanSeconds = Math.floor((Date.parse(month.spreadTo) - from) / 1000);
    const time = () =>
      new Date(from + int(0, spanSeconds - 1) * 1000).toISOString();
    const vnd = (minThousands: number, maxThousands: number) =>
      int(minThousands, maxThousands) * 1000 * 100;
    const add = (
      fields: Omit<
        BenchTransaction,
        | 'id'
        | 'userId'
        | 'sourceType'
        | 'description'
        | 'isDuplicate'
        | 'duplicateOfTransactionId'
        | 'transactionTime'
        | 'status'
      > & {
        status?: BenchStatus;
        transactionTime?: string;
        isDuplicate?: boolean;
        duplicateOfTransactionId?: string | null;
        label: string;
      },
    ): BenchTransaction => {
      sequence += 1;
      const { label, ...rest } = fields;
      const record: BenchTransaction = {
        id: benchId('txn', sequence),
        userId,
        financialAccountId: rest.financialAccountId,
        categoryId: rest.categoryId,
        merchantName: rest.merchantName,
        description: `Bench ${label} ${month.key} #${sequence}`,
        sourceType: 'MANUAL',
        amount: rest.amount,
        currency: rest.currency,
        direction: rest.direction,
        transactionTime: rest.transactionTime ?? time(),
        status: rest.status ?? 'POSTED',
        isDuplicate: rest.isDuplicate ?? false,
        duplicateOfTransactionId: rest.duplicateOfTransactionId ?? null,
      };
      transactions.push(record);
      return record;
    };
    const merchant = () => `Bench Merchant ${pad(int(1, 60))}`;

    const vndExpenses: BenchTransaction[] = [];
    for (let i = 0; i < BENCH_MONTH_MIX.vndExpenses; i++) {
      vndExpenses.push(
        add({
          label: 'expense',
          financialAccountId: pick(accounts).id,
          categoryId: pick(expenseCategories).id,
          merchantName: merchant(),
          amount: formatMinor(vnd(10, 1500)),
          currency: BENCH_BASE_CURRENCY,
          direction: 'EXPENSE',
        }),
      );
    }
    for (let i = 0; i < BENCH_MONTH_MIX.usdExpenses; i++) {
      add({
        label: 'foreign expense',
        financialAccountId: bank.id,
        categoryId: pick(expenseCategories).id,
        merchantName: merchant(),
        amount: formatMinor(int(100, 25_000)),
        currency: BENCH_FOREIGN_CURRENCY,
        direction: 'EXPENSE',
      });
    }
    for (let i = 0; i < BENCH_MONTH_MIX.incomes; i++) {
      add({
        label: 'income',
        financialAccountId: bank.id,
        categoryId: pick(incomeCategories).id,
        merchantName: null,
        amount: formatMinor(vnd(2000, 20_000)),
        currency: BENCH_BASE_CURRENCY,
        direction: 'INCOME',
      });
    }
    for (let i = 0; i < BENCH_MONTH_MIX.transfersOut; i++) {
      add({
        label: 'transfer out',
        financialAccountId: bank.id,
        categoryId: null,
        merchantName: null,
        amount: formatMinor(vnd(100, 5000)),
        currency: BENCH_BASE_CURRENCY,
        direction: 'TRANSFER_OUT',
      });
    }
    for (let i = 0; i < BENCH_MONTH_MIX.transfersIn; i++) {
      add({
        label: 'transfer in',
        financialAccountId: wallet.id,
        categoryId: null,
        merchantName: null,
        amount: formatMinor(vnd(100, 5000)),
        currency: BENCH_BASE_CURRENCY,
        direction: 'TRANSFER_IN',
      });
    }
    // Excluded rows carry real income/expense amounts, so a policy that let
    // them through would change the totals the runner verifies.
    const excluded = (
      label: string,
      status: BenchStatus,
      direction: 'INCOME' | 'EXPENSE',
    ) =>
      add({
        label,
        status,
        financialAccountId: bank.id,
        categoryId:
          direction === 'INCOME'
            ? pick(incomeCategories).id
            : pick(expenseCategories).id,
        merchantName: direction === 'INCOME' ? null : merchant(),
        amount: formatMinor(
          direction === 'INCOME' ? vnd(2000, 20_000) : vnd(10, 1500),
        ),
        currency: BENCH_BASE_CURRENCY,
        direction,
      });
    const ignoredDirections = [
      'EXPENSE',
      'EXPENSE',
      'INCOME',
      'EXPENSE',
    ] as const;
    for (let i = 0; i < BENCH_MONTH_MIX.ignored; i++) {
      excluded('ignored', 'IGNORED', ignoredDirections[i]);
    }
    // Duplicates copy a distinct eligible VND expense of the same month.
    const originals = new Set<number>();
    while (originals.size < BENCH_MONTH_MIX.duplicates) {
      originals.add(int(0, vndExpenses.length - 1));
    }
    for (const index of originals) {
      const original = vndExpenses[index];
      add({
        label: 'duplicate',
        financialAccountId: original.financialAccountId,
        categoryId: original.categoryId,
        merchantName: original.merchantName,
        amount: original.amount,
        currency: original.currency,
        direction: original.direction,
        transactionTime: original.transactionTime,
        isDuplicate: true,
        duplicateOfTransactionId: original.id,
      });
    }
    const deletedDirections = ['EXPENSE', 'INCOME', 'EXPENSE'] as const;
    for (let i = 0; i < BENCH_MONTH_MIX.deleted; i++) {
      excluded('deleted', 'DELETED', deletedDirections[i]);
    }
  }

  return {
    seed,
    anchor,
    months,
    user,
    settings,
    accounts,
    categories,
    budgets,
    transactions,
    expected: expectedCurrentMonthTotals(months, transactions),
  };
}

/**
 * Current-month totals computed from the fixture's own records, in integer
 * hundredths, without the production policy.
 */
function expectedCurrentMonthTotals(
  months: BenchMonth[],
  transactions: BenchTransaction[],
): ExpectedTotals {
  const current = months[months.length - 1];
  const from = Date.parse(current.from);
  const to = Date.parse(current.to);
  const inMonth = transactions.filter((row) => {
    const at = Date.parse(row.transactionTime);
    return at >= from && at < to;
  });

  const groups = new Map<string, ExpectedCurrencyTotals>();
  for (const row of inMonth) {
    if (row.status !== 'POSTED' || row.isDuplicate) {
      continue;
    }
    const group = groups.get(row.currency) ?? {
      currency: row.currency,
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      eligibleCount: 0,
    };
    if (row.direction === 'INCOME') {
      group.incomeMinor += parseMinor(row.amount);
    } else if (row.direction === 'EXPENSE') {
      group.expenseMinor += parseMinor(row.amount);
    }
    group.netMinor = group.incomeMinor - group.expenseMinor;
    group.eligibleCount += 1;
    groups.set(row.currency, group);
  }
  const currencies = [...groups.values()].sort((a, b) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
  );
  const base = groups.get(BENCH_BASE_CURRENCY) ?? {
    currency: BENCH_BASE_CURRENCY,
    incomeMinor: 0,
    expenseMinor: 0,
    netMinor: 0,
    eligibleCount: 0,
  };
  const eligibleCount = currencies.reduce(
    (sum, group) => sum + group.eligibleCount,
    0,
  );
  const money = (minor: number) => minor / 100;

  return {
    month: current.key,
    periodStart: current.from,
    periodEnd: current.to,
    baseCurrency: BENCH_BASE_CURRENCY,
    currencies,
    eligibleCount,
    totalCount: inMonth.length,
    overview: {
      month: current.key,
      currency: BENCH_BASE_CURRENCY,
      income: money(base.incomeMinor),
      expense: money(base.expenseMinor),
      netCashflow: money(base.netMinor),
      transactionCount: eligibleCount,
      currencies: currencies.map((group) => ({
        currency: group.currency,
        income: money(group.incomeMinor),
        expense: money(group.expenseMinor),
        netCashflow: money(group.netMinor),
        transactionCount: group.eligibleCount,
      })),
      periodStart: current.from,
      periodEnd: current.to,
      timeZone: BENCH_TIME_ZONE,
    },
  };
}
