import {
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import {
  DEFAULT_TIME_ZONE,
  LedgerRow,
  PeriodSettings,
  completedMonthsRange,
  completedUserMonths,
  eligibleTransactionWhere,
  isEligibleTransaction,
  isInRange,
  localDateKey,
  parseMonthKey,
  recentUserMonths,
  resolvePeriodSettings,
  savingRatePercent,
  shiftMonthKey,
  startOfLocalDay,
  summarizeTransactions,
  totalsByCurrency,
  totalsForCurrency,
  treatmentOf,
  userMonthContaining,
  userMonthForKey,
  userMonthsEndingAt,
  visibleTransactionWhere,
} from './financial-period-policy';

// T031 (TX-003, DASH-001–DASH-003, BUDGET-002, DATA-004): golden cases for the
// one eligibility, transfer, duplicate, currency, and period policy shared by
// transaction lists, dashboard, analytics, budgets, and goals. Every expected
// value is a hand-calculated literal; instants were cross-checked against a
// brute-force Intl scan of the 2026 time-zone rules.

const { POSTED, PENDING, IGNORED, DELETED, NEEDS_REVIEW } = TransactionStatus;
const { INCOME, EXPENSE, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT } =
  TransactionDirection;

const HCM: PeriodSettings = { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 };
const HCM_25: PeriodSettings = {
  timeZone: 'Asia/Ho_Chi_Minh',
  monthStartDay: 25,
};
const iso = (date: Date) => date.toISOString();
const span = (month: { key: string; from: Date; to: Date }) => ({
  key: month.key,
  from: iso(month.from),
  to: iso(month.to),
});

const row = (
  status: TransactionStatus,
  isDuplicate: boolean,
  direction: TransactionDirection,
  currency: string,
  amount: string,
): LedgerRow => ({ status, isDuplicate, direction, currency, amount });

// Canonical ledger. Only posted, non-duplicate income and expense count.
const LEDGER: LedgerRow[] = [
  row(POSTED, false, INCOME, 'VND', '20000000'), // L1 counts
  row(POSTED, false, EXPENSE, 'VND', '3250000'), // L2 counts
  row(POSTED, false, EXPENSE, 'VND', '1200000'), // L3 counts
  row(PENDING, false, EXPENSE, 'VND', '999000'), // L4 pending
  row(NEEDS_REVIEW, false, EXPENSE, 'VND', '888000'), // L5 needs review
  row(IGNORED, false, EXPENSE, 'VND', '777000'), // L6 ignored
  row(DELETED, false, EXPENSE, 'VND', '666000'), // L7 soft-deleted
  row(POSTED, true, EXPENSE, 'VND', '3250000'), // L8 confirmed duplicate of L2
  row(POSTED, false, TRANSFER_OUT, 'VND', '5000000'), // L9 transfer
  row(POSTED, false, TRANSFER_IN, 'VND', '5000000'), // L10 transfer
  row(POSTED, false, ADJUSTMENT, 'VND', '100000'), // L11 adjustment
  row(POSTED, false, EXPENSE, 'USD', '12.04'), // L12 counts
  row(POSTED, false, EXPENSE, 'USD', '0.10'), // L13 counts
  row(POSTED, false, EXPENSE, 'USD', '0.20'), // L14 counts (float trap)
  row(POSTED, false, INCOME, 'USD', '100.10'), // L15 counts
  row(IGNORED, false, INCOME, 'USD', '50.00'), // L16 ignored
  row(POSTED, true, INCOME, 'USD', '100.10'), // L17 duplicate of L15
  row(DELETED, true, INCOME, 'VND', '1000000'), // L18 deleted duplicate
];

describe('financial period policy (T031)', () => {
  describe('status eligibility and treatment (TX-003, DATA-004)', () => {
    it.each([
      [POSTED, false, INCOME, 'INCOME'],
      [POSTED, false, EXPENSE, 'EXPENSE'],
      [POSTED, false, TRANSFER_IN, 'TRANSFER'],
      [POSTED, false, TRANSFER_OUT, 'TRANSFER'],
      [POSTED, false, ADJUSTMENT, 'EXCLUDED'],
      [POSTED, true, INCOME, 'EXCLUDED'],
      [POSTED, true, EXPENSE, 'EXCLUDED'],
      [POSTED, true, TRANSFER_OUT, 'EXCLUDED'],
      [PENDING, false, EXPENSE, 'EXCLUDED'],
      [NEEDS_REVIEW, false, INCOME, 'EXCLUDED'],
      [IGNORED, false, EXPENSE, 'EXCLUDED'],
      [IGNORED, false, TRANSFER_IN, 'EXCLUDED'],
      [DELETED, false, INCOME, 'EXCLUDED'],
      [DELETED, true, EXPENSE, 'EXCLUDED'],
    ] as const)(
      '%s, duplicate=%s, %s is treated as %s',
      (status, isDuplicate, direction, expected) => {
        expect(treatmentOf({ status, isDuplicate, direction })).toBe(expected);
      },
    );

    it.each([
      [POSTED, false, true],
      [POSTED, true, false],
      [PENDING, false, false],
      [NEEDS_REVIEW, false, false],
      [IGNORED, false, false],
      [DELETED, false, false],
    ] as const)(
      '%s with duplicate=%s is eligible: %s',
      (status, isDuplicate, expected) => {
        expect(isEligibleTransaction({ status, isDuplicate })).toBe(expected);
      },
    );
  });

  describe('totals: transfers, duplicates, and mixed currencies (DASH-001)', () => {
    it('sums only eligible income and expense, per currency, never across currencies', () => {
      expect(summarizeTransactions(LEDGER)).toEqual([
        {
          currency: 'USD',
          income: 100.1,
          expense: 12.34,
          netCashflow: 87.76,
          transactionCount: 4,
        },
        {
          currency: 'VND',
          income: 20000000,
          expense: 4450000,
          netCashflow: 15550000,
          transactionCount: 6,
        },
      ]);
    });

    it('is independent of row order (DASH-003)', () => {
      expect(summarizeTransactions([...LEDGER].reverse())).toEqual(
        summarizeTransactions(LEDGER),
      );
    });

    it('folds database per-direction sums into the same per-currency totals', () => {
      expect(
        totalsByCurrency([
          { currency: 'VND', direction: INCOME, amount: '20000000', count: 1 },
          {
            currency: 'VND',
            direction: EXPENSE,
            amount: new Prisma.Decimal('4450000'),
            count: 2,
          },
          {
            currency: 'VND',
            direction: TRANSFER_OUT,
            amount: '5000000',
            count: 1,
          },
          {
            currency: 'VND',
            direction: TRANSFER_IN,
            amount: '5000000',
            count: 1,
          },
          {
            currency: 'VND',
            direction: ADJUSTMENT,
            amount: '100000',
            count: 1,
          },
          { currency: 'USD', direction: EXPENSE, amount: '12.04', count: 1 },
          { currency: 'USD', direction: EXPENSE, amount: '0.30', count: 2 },
          { currency: 'USD', direction: INCOME, amount: '100.10', count: 1 },
          { currency: 'EUR', direction: TRANSFER_OUT, amount: null, count: 1 },
        ]),
      ).toEqual([
        {
          currency: 'EUR',
          income: 0,
          expense: 0,
          netCashflow: 0,
          transactionCount: 1,
        },
        {
          currency: 'USD',
          income: 100.1,
          expense: 12.34,
          netCashflow: 87.76,
          transactionCount: 4,
        },
        {
          currency: 'VND',
          income: 20000000,
          expense: 4450000,
          netCashflow: 15550000,
          transactionCount: 6,
        },
      ]);
    });

    it('reports a currency without eligible records as zero totals', () => {
      expect(totalsForCurrency(summarizeTransactions(LEDGER), 'EUR')).toEqual({
        currency: 'EUR',
        income: 0,
        expense: 0,
        netCashflow: 0,
        transactionCount: 0,
      });
      expect(totalsForCurrency(summarizeTransactions(LEDGER), 'VND')).toEqual({
        currency: 'VND',
        income: 20000000,
        expense: 4450000,
        netCashflow: 15550000,
        transactionCount: 6,
      });
    });

    it('returns no currency groups for an empty ledger', () => {
      expect(summarizeTransactions([])).toEqual([]);
    });
  });

  describe('database predicates mirror the in-memory rule', () => {
    const range = {
      from: new Date('2026-08-31T17:00:00.000Z'),
      to: new Date('2026-09-30T17:00:00.000Z'),
    };

    it('totals read only posted, non-duplicate rows in a half-open range', () => {
      expect(eligibleTransactionWhere('user-1', range)).toEqual({
        userId: 'user-1',
        status: 'POSTED',
        isDuplicate: false,
        transactionTime: { gte: range.from, lt: range.to },
      });
      expect(eligibleTransactionWhere('user-1')).toEqual({
        userId: 'user-1',
        status: 'POSTED',
        isDuplicate: false,
      });
    });

    it('lists show every owned row except soft-deleted ones (DATA-004)', () => {
      expect(visibleTransactionWhere('user-1')).toEqual({
        userId: 'user-1',
        status: { not: 'DELETED' },
      });
    });
  });

  describe('user months: timezone and month-start day (DASH-002)', () => {
    it('a month key is the local month that starts on the month-start day', () => {
      expect(span(userMonthForKey('2026-09', HCM))).toEqual({
        key: '2026-09',
        from: '2026-08-31T17:00:00.000Z',
        to: '2026-09-30T17:00:00.000Z',
      });
      expect(userMonthForKey('2026-09', HCM).startDate).toBe('2026-09-01');
    });

    it('assigns each instant to exactly one month at the local boundary', () => {
      expect(
        userMonthContaining(new Date('2026-08-31T16:59:59.999Z'), HCM).key,
      ).toBe('2026-08');
      expect(
        userMonthContaining(new Date('2026-08-31T17:00:00.000Z'), HCM).key,
      ).toBe('2026-09');
      expect(
        userMonthContaining(new Date('2026-09-30T16:59:59.999Z'), HCM).key,
      ).toBe('2026-09');
      expect(
        userMonthContaining(new Date('2026-09-30T17:00:00.000Z'), HCM).key,
      ).toBe('2026-10');
    });

    it('filters the boundary ledger with the half-open month range', () => {
      const september = userMonthForKey('2026-09', HCM);
      const boundaryRows: Array<LedgerRow & { at: string }> = [
        {
          ...row(POSTED, false, EXPENSE, 'VND', '400000'),
          at: '2026-08-31T16:59:59.999Z',
        },
        {
          ...row(POSTED, false, EXPENSE, 'VND', '300000'),
          at: '2026-08-31T17:00:00.000Z',
        },
        {
          ...row(POSTED, false, INCOME, 'VND', '700000'),
          at: '2026-09-30T16:59:59.999Z',
        },
        {
          ...row(POSTED, false, INCOME, 'VND', '900000'),
          at: '2026-09-30T17:00:00.000Z',
        },
      ];
      const inSeptember = boundaryRows.filter((entry) =>
        isInRange(new Date(entry.at), september),
      );
      expect(summarizeTransactions(inSeptember)).toEqual([
        {
          currency: 'VND',
          income: 700000,
          expense: 300000,
          netCashflow: 400000,
          transactionCount: 2,
        },
      ]);
    });

    it('with month-start day 25, 2026-09-23 belongs to the month starting 2026-08-25', () => {
      const month = userMonthContaining(
        new Date('2026-09-23T03:00:00.000Z'),
        HCM_25,
      );
      expect(span(month)).toEqual({
        key: '2026-08',
        from: '2026-08-24T17:00:00.000Z',
        to: '2026-09-24T17:00:00.000Z',
      });
      expect(month.startDate).toBe('2026-08-25');
      expect(
        userMonthContaining(new Date('2026-09-24T16:59:59.999Z'), HCM_25).key,
      ).toBe('2026-08');
      expect(
        userMonthContaining(new Date('2026-09-24T17:00:00.000Z'), HCM_25).key,
      ).toBe('2026-09');
    });

    it('rolls over the year', () => {
      expect(
        span(userMonthContaining(new Date('2026-12-31T17:00:00.000Z'), HCM)),
      ).toEqual({
        key: '2027-01',
        from: '2026-12-31T17:00:00.000Z',
        to: '2027-01-31T17:00:00.000Z',
      });
      expect(
        span(userMonthContaining(new Date('2027-01-10T03:00:00.000Z'), HCM_25)),
      ).toEqual({
        key: '2026-12',
        from: '2026-12-24T17:00:00.000Z',
        to: '2027-01-24T17:00:00.000Z',
      });
      expect(shiftMonthKey('2027-01', -1)).toBe('2026-12');
      expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
      expect(shiftMonthKey('2026-09', -12)).toBe('2025-09');
    });

    it('follows daylight-saving changes (America/New_York)', () => {
      const ny: PeriodSettings = {
        timeZone: 'America/New_York',
        monthStartDay: 1,
      };
      expect(span(userMonthForKey('2026-03', ny))).toEqual({
        key: '2026-03',
        from: '2026-03-01T05:00:00.000Z',
        to: '2026-04-01T04:00:00.000Z',
      });
      expect(span(userMonthForKey('2026-11', ny))).toEqual({
        key: '2026-11',
        from: '2026-11-01T04:00:00.000Z',
        to: '2026-12-01T05:00:00.000Z',
      });
    });

    it('starts a day whose midnight is skipped at its first instant (America/Havana, day 8)', () => {
      const havana8: PeriodSettings = {
        timeZone: 'America/Havana',
        monthStartDay: 8,
      };
      expect(span(userMonthForKey('2026-03', havana8))).toEqual({
        key: '2026-03',
        from: '2026-03-08T05:00:00.000Z',
        to: '2026-04-08T04:00:00.000Z',
      });
      expect(
        span(
          userMonthContaining(new Date('2026-03-08T04:59:59.999Z'), havana8),
        ),
      ).toEqual({
        key: '2026-02',
        from: '2026-02-08T05:00:00.000Z',
        to: '2026-03-08T05:00:00.000Z',
      });
    });

    it('starts a day whose midnight occurs twice at its first occurrence (America/Havana, 2026-11-01)', () => {
      const havana: PeriodSettings = {
        timeZone: 'America/Havana',
        monthStartDay: 1,
      };
      expect(span(userMonthForKey('2026-10', havana))).toEqual({
        key: '2026-10',
        from: '2026-10-01T04:00:00.000Z',
        to: '2026-11-01T04:00:00.000Z',
      });
      expect(span(userMonthForKey('2026-11', havana))).toEqual({
        key: '2026-11',
        from: '2026-11-01T04:00:00.000Z',
        to: '2026-12-01T05:00:00.000Z',
      });
      for (const instant of [
        '2026-11-01T04:30:00.000Z',
        '2026-11-01T05:30:00.000Z',
      ]) {
        expect(userMonthContaining(new Date(instant), havana).key).toBe(
          '2026-11',
        );
      }
      expect(
        userMonthContaining(new Date('2026-11-01T03:59:59.999Z'), havana).key,
      ).toBe('2026-10');
    });

    it('handles a skipped midnight on a non-first month-start day (America/Santiago, day 6)', () => {
      const santiago6: PeriodSettings = {
        timeZone: 'America/Santiago',
        monthStartDay: 6,
      };
      expect(span(userMonthForKey('2026-09', santiago6))).toEqual({
        key: '2026-09',
        from: '2026-09-06T04:00:00.000Z',
        to: '2026-10-06T03:00:00.000Z',
      });
      expect(
        userMonthContaining(new Date('2026-09-06T03:59:59.999Z'), santiago6)
          .key,
      ).toBe('2026-08');
    });

    it('computes local day starts and local dates', () => {
      expect(iso(startOfLocalDay('2026-03-08', 'America/Havana'))).toBe(
        '2026-03-08T05:00:00.000Z',
      );
      expect(iso(startOfLocalDay('2026-11-01', 'America/Havana'))).toBe(
        '2026-11-01T04:00:00.000Z',
      );
      expect(iso(startOfLocalDay('2026-04-05', 'America/Santiago'))).toBe(
        '2026-04-05T04:00:00.000Z',
      );
      expect(iso(startOfLocalDay('2026-03-29', 'Asia/Beirut'))).toBe(
        '2026-03-28T22:00:00.000Z',
      );
      expect(
        localDateKey(new Date('2026-08-31T17:00:00.000Z'), 'Asia/Ho_Chi_Minh'),
      ).toBe('2026-09-01');
      expect(
        localDateKey(new Date('2026-11-01T03:59:59.999Z'), 'America/Havana'),
      ).toBe('2026-10-31');
      expect(
        localDateKey(new Date('2026-11-01T05:30:00.000Z'), 'America/Havana'),
      ).toBe('2026-11-01');
    });
  });

  describe('month windows and completed months (GOAL-003 inputs)', () => {
    const now = new Date('2026-09-23T03:00:00.000Z');

    it('lists the recent months oldest first, ending with the current month', () => {
      expect(recentUserMonths(6, now, HCM).map((month) => month.key)).toEqual([
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
      ]);
      expect(
        recentUserMonths(3, new Date('2026-12-31T17:00:00.000Z'), HCM).map(
          (month) => month.key,
        ),
      ).toEqual(['2026-11', '2026-12', '2027-01']);
    });

    it('excludes the current month from completed months', () => {
      expect(
        completedUserMonths(3, now, HCM).map((month) => month.key),
      ).toEqual(['2026-06', '2026-07', '2026-08']);
      const range = completedMonthsRange(3, now, HCM);
      expect({ from: iso(range.from), to: iso(range.to) }).toEqual({
        from: '2026-05-31T17:00:00.000Z',
        to: '2026-08-31T17:00:00.000Z',
      });
    });

    it('uses month-start day 25 across a year boundary', () => {
      const january = new Date('2027-01-10T03:00:00.000Z');
      expect(
        completedUserMonths(3, january, HCM_25).map((month) => month.key),
      ).toEqual(['2026-09', '2026-10', '2026-11']);
      const range = completedMonthsRange(3, january, HCM_25);
      expect({ from: iso(range.from), to: iso(range.to) }).toEqual({
        from: '2026-09-24T17:00:00.000Z',
        to: '2026-12-24T17:00:00.000Z',
      });
    });
  });

  describe('settings and month keys', () => {
    it('uses the stored timezone and month-start day when valid', () => {
      expect(
        resolvePeriodSettings({
          timezone: 'America/New_York',
          defaultMonthStartDay: 25,
        }),
      ).toEqual({ timeZone: 'America/New_York', monthStartDay: 25 });
    });

    it('falls back deterministically for missing or invalid stored values', () => {
      expect(resolvePeriodSettings({})).toEqual({
        timeZone: DEFAULT_TIME_ZONE,
        monthStartDay: 1,
      });
      expect(
        resolvePeriodSettings({
          timezone: 'Mars/Olympus_Mons',
          defaultMonthStartDay: 29,
        }),
      ).toEqual({ timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 });
      expect(
        resolvePeriodSettings({ timezone: null, defaultMonthStartDay: 0 }),
      ).toEqual({ timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 });
    });

    it('accepts only YYYY-MM month keys with a real month', () => {
      expect(parseMonthKey('2026-09')).toEqual({ year: 2026, month: 9 });
      for (const bad of [
        '2026-13',
        '2026-00',
        '2026-9',
        '26-09',
        '2026-09-01',
        '',
      ]) {
        expect(parseMonthKey(bad)).toBeNull();
      }
    });
  });
  // Added after the independent coverage review of T031.
  describe('coverage review additions', () => {
    it('a currency whose rows are all ineligible forms no group', () => {
      const withJpy = [
        ...LEDGER,
        row(IGNORED, false, EXPENSE, 'JPY', '5000'),
        row(DELETED, false, INCOME, 'JPY', '7000'),
        row(POSTED, true, EXPENSE, 'JPY', '300'),
        row(PENDING, false, INCOME, 'JPY', '900'),
      ];
      expect(summarizeTransactions(withJpy)).toEqual(
        summarizeTransactions(LEDGER),
      );
      expect(totalsForCurrency(summarizeTransactions(withJpy), 'JPY')).toEqual({
        currency: 'JPY',
        income: 0,
        expense: 0,
        netCashflow: 0,
        transactionCount: 0,
      });
    });

    it('a transfer-only currency forms the same zero-money group in both folds', () => {
      const expected = [
        {
          currency: 'EUR',
          income: 0,
          expense: 0,
          netCashflow: 0,
          transactionCount: 1,
        },
      ];
      expect(
        summarizeTransactions([
          row(POSTED, false, TRANSFER_OUT, 'EUR', '250.00'),
        ]),
      ).toEqual(expected);
      expect(
        totalsByCurrency([
          {
            currency: 'EUR',
            direction: TRANSFER_OUT,
            amount: '250.00',
            count: 1,
          },
        ]),
      ).toEqual(expected);
    });

    it('savings rate is net ÷ income in whole percent, 0 without income', () => {
      expect(savingRatePercent(20000000, 15550000)).toBe(78);
      expect(savingRatePercent(100.1, 87.76)).toBe(88);
      expect(savingRatePercent(0, 0)).toBe(0);
      expect(savingRatePercent(0, -1500000)).toBe(0);
      expect(savingRatePercent(1000000, -500000)).toBe(-50);
      expect(savingRatePercent(1000, -4)).toBe(0);
    });

    it('completed months switch exactly at the local month start', () => {
      const atStart = new Date('2026-08-31T17:00:00.000Z');
      expect(
        completedUserMonths(3, atStart, HCM).map((month) => month.key),
      ).toEqual(['2026-06', '2026-07', '2026-08']);
      const rangeAtStart = completedMonthsRange(3, atStart, HCM);
      expect({
        from: iso(rangeAtStart.from),
        to: iso(rangeAtStart.to),
      }).toEqual({
        from: '2026-05-31T17:00:00.000Z',
        to: '2026-08-31T17:00:00.000Z',
      });

      const justBefore = new Date('2026-08-31T16:59:59.999Z');
      expect(
        completedUserMonths(3, justBefore, HCM).map((month) => month.key),
      ).toEqual(['2026-05', '2026-06', '2026-07']);
      const rangeBefore = completedMonthsRange(3, justBefore, HCM);
      expect({ from: iso(rangeBefore.from), to: iso(rangeBefore.to) }).toEqual({
        from: '2026-04-30T17:00:00.000Z',
        to: '2026-07-31T17:00:00.000Z',
      });
    });

    it('month-start day 28 works in February and is kept by the settings', () => {
      const hcm28: PeriodSettings = {
        timeZone: 'Asia/Ho_Chi_Minh',
        monthStartDay: 28,
      };
      const february = userMonthForKey('2026-02', hcm28);
      expect(span(february)).toEqual({
        key: '2026-02',
        from: '2026-02-27T17:00:00.000Z',
        to: '2026-03-27T17:00:00.000Z',
      });
      expect(february.startDate).toBe('2026-02-28');
      expect(
        span(userMonthContaining(new Date('2026-02-27T03:00:00.000Z'), hcm28)),
      ).toEqual({
        key: '2026-01',
        from: '2026-01-27T17:00:00.000Z',
        to: '2026-02-27T17:00:00.000Z',
      });
      expect(
        resolvePeriodSettings({
          timezone: 'Asia/Ho_Chi_Minh',
          defaultMonthStartDay: 28,
        }),
      ).toEqual(hcm28);
    });

    it('trend windows are contiguous months ending at the requested month', () => {
      expect(userMonthsEndingAt('2026-09', 3, HCM).map(span)).toEqual([
        {
          key: '2026-07',
          from: '2026-06-30T17:00:00.000Z',
          to: '2026-07-31T17:00:00.000Z',
        },
        {
          key: '2026-08',
          from: '2026-07-31T17:00:00.000Z',
          to: '2026-08-31T17:00:00.000Z',
        },
        {
          key: '2026-09',
          from: '2026-08-31T17:00:00.000Z',
          to: '2026-09-30T17:00:00.000Z',
        },
      ]);
      expect(userMonthsEndingAt('2026-09', 0, HCM)).toEqual([]);
    });

    it('matches the budget activeUntil worked example (data-model)', () => {
      expect(iso(startOfLocalDay('2026-10-01', 'Asia/Ho_Chi_Minh'))).toBe(
        '2026-09-30T17:00:00.000Z',
      );
    });

    it('accepts month keys only from 1900-01 to 2099-12, without two-digit-year remapping', () => {
      for (const bad of [
        '9999-12',
        '0000-01',
        '0050-03',
        '1899-12',
        '2100-01',
      ]) {
        expect(parseMonthKey(bad)).toBeNull();
      }
      expect(parseMonthKey('1900-01')).toEqual({ year: 1900, month: 1 });
      expect(parseMonthKey('2099-12')).toEqual({ year: 2099, month: 12 });
      // The edges still produce windows and a following month.
      expect(userMonthsEndingAt('1900-01', 24, HCM)[0].key).toBe('1898-02');
      expect(iso(userMonthForKey('2099-12', HCM).to)).toBe(
        '2099-12-31T17:00:00.000Z',
      );
      expect(iso(startOfLocalDay('0050-03-01', 'UTC'))).toBe(
        '0050-03-01T00:00:00.000Z',
      );
    });

    it('treats currency codes that differ only in case as one currency', () => {
      expect(
        totalsByCurrency([
          { currency: 'vnd', direction: INCOME, amount: '100', count: 1 },
          { currency: 'VND ', direction: EXPENSE, amount: '40', count: 1 },
          { currency: 'VND', direction: EXPENSE, amount: '10', count: 2 },
        ]),
      ).toEqual([
        {
          currency: 'VND',
          income: 100,
          expense: 50,
          netCashflow: 50,
          transactionCount: 4,
        },
      ]);
    });

    it('keeps a valid timezone alias and computes the same ranges', () => {
      const saigon = resolvePeriodSettings({ timezone: 'Asia/Saigon' });
      expect(saigon).toEqual({ timeZone: 'Asia/Saigon', monthStartDay: 1 });
      expect(span(userMonthForKey('2026-09', saigon))).toEqual(
        span(userMonthForKey('2026-09', HCM)),
      );
    });
  });
});
