import { BudgetPeriod, Prisma } from '@prisma/client';
import {
  BudgetSpendDb,
  budgetActiveRange,
  budgetSpend,
  monthlyInstanceAt,
  monthlyInstanceForMonth,
} from './budget-spend.query';
import { userMonthForKey } from './financial-period-policy';

/**
 * BUDGET-002, BUDGET-005 (T069): the MONTHLY period instance and the shared
 * spend aggregate. Budget dates are user-local calendar dates; the end date
 * is inclusive (data-model "Budget period instances").
 */

const HCM = 'Asia/Ho_Chi_Minh';
const DAY1 = { timeZone: HCM, monthStartDay: 1 };
const DAY25 = { timeZone: HCM, monthStartDay: 25 };
const NOW = new Date('2026-09-23T03:00:00.000Z'); // 2026-09-23 10:00 +07:00

const monthly = (
  startsAt: string,
  endsAt: string | null = null,
  period: BudgetPeriod = 'MONTHLY',
) => ({
  period,
  startsAt: new Date(startsAt),
  endsAt: endsAt ? new Date(endsAt) : null,
});

describe('budgetActiveRange (T069)', () => {
  it('starts at the local start date and ends the day after the local end date', () => {
    expect(
      budgetActiveRange(
        {
          startsAt: new Date('2026-09-10T00:00:00Z'),
          endsAt: new Date('2026-09-30T00:00:00Z'),
        },
        HCM,
      ),
    ).toEqual({
      from: new Date('2026-09-09T17:00:00.000Z'),
      until: new Date('2026-09-30T17:00:00.000Z'),
    });
  });

  it('is unbounded without an end date', () => {
    expect(
      budgetActiveRange(
        { startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: null },
        HCM,
      ).until,
    ).toBeNull();
  });

  it('reads a date-only value (UTC midnight) as that date west of UTC too (review finding)', () => {
    // "2026-09-01" is stored as 2026-09-01T00:00Z, which is 2026-08-31 19:00
    // in Bogota (UTC-5); it still means 1 September.
    expect(
      budgetActiveRange(
        {
          startsAt: new Date('2026-09-01T00:00:00Z'),
          endsAt: new Date('2026-09-01T00:00:00Z'),
        },
        'America/Bogota',
      ),
    ).toEqual({
      from: new Date('2026-09-01T05:00:00.000Z'),
      until: new Date('2026-09-02T05:00:00.000Z'),
    });
  });

  it('reads any other instant in the user time zone', () => {
    // 2026-09-01T03:00Z is 2026-08-31 22:00 in Bogota.
    expect(
      budgetActiveRange(
        { startsAt: new Date('2026-09-01T03:00:00Z'), endsAt: null },
        'America/Bogota',
      ).from,
    ).toEqual(new Date('2026-08-31T05:00:00.000Z'));
  });

  it('gives a west-of-UTC account no extra instance for a date-only start on the month-start day', () => {
    const settings = { timeZone: 'America/Bogota', monthStartDay: 1 };
    expect(
      monthlyInstanceAt(
        monthly('2026-09-01T00:00:00Z'),
        new Date('2026-08-31T20:00:00Z'), // 31 August 15:00 in Bogota
        settings,
      ),
    ).toEqual({ supported: true, instance: null });
  });
});

describe('monthlyInstanceAt (T069)', () => {
  it('is the user month containing the instant, month-start day 1', () => {
    expect(
      monthlyInstanceAt(monthly('2026-01-01T00:00:00Z'), NOW, DAY1),
    ).toEqual({
      supported: true,
      instance: {
        key: '2026-09-01',
        start: new Date('2026-08-31T17:00:00.000Z'),
        end: new Date('2026-09-30T17:00:00.000Z'),
        usage: {
          from: new Date('2026-08-31T17:00:00.000Z'),
          to: new Date('2026-09-30T17:00:00.000Z'),
        },
      },
    });
  });

  it('starts on day 25 of the previous month for 2026-09-23 with month-start day 25', () => {
    const result = monthlyInstanceAt(
      monthly('2026-01-01T00:00:00Z'),
      NOW,
      DAY25,
    );
    expect(result).toMatchObject({
      supported: true,
      instance: {
        key: '2026-08-25',
        start: new Date('2026-08-24T17:00:00.000Z'),
        end: new Date('2026-09-24T17:00:00.000Z'),
      },
    });
  });

  it('rolls to the next instance exactly at local midnight of the month-start day', () => {
    const before = monthlyInstanceAt(
      monthly('2026-01-01T00:00:00Z'),
      new Date('2026-09-24T16:59:59.999Z'),
      DAY25,
    );
    const at = monthlyInstanceAt(
      monthly('2026-01-01T00:00:00Z'),
      new Date('2026-09-24T17:00:00.000Z'),
      DAY25,
    );
    expect(before).toMatchObject({ instance: { key: '2026-08-25' } });
    expect(at).toMatchObject({ instance: { key: '2026-09-25' } });
  });

  it('clips usage to a start date inside the instance', () => {
    expect(
      monthlyInstanceAt(monthly('2026-09-10T00:00:00Z'), NOW, DAY1),
    ).toMatchObject({
      instance: {
        key: '2026-09-01',
        start: new Date('2026-08-31T17:00:00.000Z'),
        usage: {
          from: new Date('2026-09-09T17:00:00.000Z'),
          to: new Date('2026-09-30T17:00:00.000Z'),
        },
      },
    });
  });

  it('clips usage to an end date inside the instance (inclusive end date)', () => {
    expect(
      monthlyInstanceAt(
        monthly('2026-01-01T00:00:00Z', '2026-09-20T00:00:00Z'),
        new Date('2026-09-15T03:00:00Z'),
        DAY1,
      ),
    ).toMatchObject({
      instance: {
        key: '2026-09-01',
        usage: {
          from: new Date('2026-08-31T17:00:00.000Z'),
          to: new Date('2026-09-20T17:00:00.000Z'),
        },
      },
    });
  });

  it('has no instance before the budget starts or after it ends', () => {
    expect(
      monthlyInstanceAt(monthly('2026-10-05T00:00:00Z'), NOW, DAY1),
    ).toEqual({
      supported: true,
      instance: null,
    });
    expect(
      monthlyInstanceAt(
        monthly('2026-01-01T00:00:00Z', '2026-08-15T00:00:00Z'),
        NOW,
        DAY1,
      ),
    ).toEqual({ supported: true, instance: null });
  });

  it('has no instance when the end date is the day before the instance starts', () => {
    expect(
      monthlyInstanceAt(
        monthly('2026-01-01T00:00:00Z', '2026-08-31T00:00:00Z'),
        NOW,
        DAY1,
      ),
    ).toEqual({ supported: true, instance: null });
  });

  it('has a one-day instance when the end date is the instance start date', () => {
    expect(
      monthlyInstanceAt(
        monthly('2026-01-01T00:00:00Z', '2026-09-01T00:00:00Z'),
        NOW,
        DAY1,
      ),
    ).toMatchObject({
      instance: {
        key: '2026-09-01',
        usage: {
          from: new Date('2026-08-31T17:00:00.000Z'),
          to: new Date('2026-09-01T17:00:00.000Z'),
        },
      },
    });
  });

  it.each(['WEEKLY', 'YEARLY', 'CUSTOM'] as BudgetPeriod[])(
    'is not supported for %s budgets',
    (period) => {
      expect(
        monthlyInstanceAt(
          monthly('2026-01-01T00:00:00Z', null, period),
          NOW,
          DAY1,
        ),
      ).toEqual({ supported: false });
    },
  );

  it('gives the same instance for a requested user month', () => {
    expect(
      monthlyInstanceForMonth(
        monthly('2026-01-01T00:00:00Z'),
        userMonthForKey('2026-08', DAY25),
        DAY25,
      ),
    ).toEqual(monthlyInstanceAt(monthly('2026-01-01T00:00:00Z'), NOW, DAY25));
  });
});

describe('budgetSpend (T069)', () => {
  type Row = {
    categoryId: string | null;
    currency: string;
    amount: string;
    transactionTime: Date;
  };
  const RANGE = {
    from: new Date('2026-08-31T17:00:00.000Z'),
    to: new Date('2026-09-30T17:00:00.000Z'),
  };

  /** Rows are already eligible EXPENSE rows; the fake applies the time range. */
  const fakeDb = (rows: Row[], excluded: string[] = []) => {
    const groupBy = jest.fn(
      (args: { where: { AND: Prisma.TransactionWhereInput[] } }) => {
        const time = args.where.AND.find((part) => part.transactionTime)
          ?.transactionTime as { gte: Date; lt: Date };
        const groups = new Map<
          string,
          { categoryId: string | null; currency: string; sum: Prisma.Decimal }
        >();
        for (const row of rows) {
          if (row.transactionTime < time.gte || row.transactionTime >= time.lt)
            continue;
          const key = `${row.categoryId}|${row.currency}`;
          const group = groups.get(key) ?? {
            categoryId: row.categoryId,
            currency: row.currency,
            sum: new Prisma.Decimal(0),
          };
          group.sum = group.sum.plus(row.amount);
          groups.set(key, group);
        }
        return Promise.resolve(
          [...groups.values()].map((group) => ({
            categoryId: group.categoryId,
            currency: group.currency,
            _sum: { amount: group.sum },
          })),
        );
      },
    );
    const findMany = jest.fn(() =>
      Promise.resolve(excluded.map((id) => ({ id }))),
    );
    return {
      db: {
        transaction: { groupBy },
        transactionCategory: { findMany },
      } as unknown as BudgetSpendDb,
      groupBy,
    };
  };
  const inRange = new Date('2026-09-10T03:00:00.000Z');

  it('sums one category in the budget currency, codes normalized, exactly', async () => {
    const { db } = fakeDb([
      {
        categoryId: 'food',
        currency: 'VND',
        amount: '100.10',
        transactionTime: inRange,
      },
      {
        categoryId: 'food',
        currency: 'vnd ',
        amount: '0.20',
        transactionTime: inRange,
      },
      {
        categoryId: 'food',
        currency: 'USD',
        amount: '999',
        transactionTime: inRange,
      },
      {
        categoryId: 'rent',
        currency: 'VND',
        amount: '5000',
        transactionTime: inRange,
      },
    ]);
    const spend = await budgetSpend(db, 'user-1', [
      { id: 'b1', categoryId: 'food', currency: 'VND', range: RANGE },
    ]);
    expect(spend.get('b1')?.toString()).toBe('100.3');
  });

  it('counts every expense category but budget-excluded ones for an all-categories budget, uncategorized included', async () => {
    const { db } = fakeDb(
      [
        {
          categoryId: 'food',
          currency: 'VND',
          amount: '100',
          transactionTime: inRange,
        },
        {
          categoryId: null,
          currency: 'VND',
          amount: '10',
          transactionTime: inRange,
        },
        {
          categoryId: 'savings',
          currency: 'VND',
          amount: '1000',
          transactionTime: inRange,
        },
      ],
      ['savings'],
    );
    const spend = await budgetSpend(db, 'user-1', [
      { id: 'all', categoryId: null, currency: 'VND', range: RANGE },
    ]);
    expect(spend.get('all')?.toString()).toBe('110');
  });

  it("applies each budget's own range and reports 0 for no spend", async () => {
    const { db } = fakeDb([
      {
        categoryId: 'food',
        currency: 'VND',
        amount: '100',
        transactionTime: new Date('2026-09-05T03:00:00Z'),
      },
      {
        categoryId: 'food',
        currency: 'VND',
        amount: '7',
        transactionTime: new Date('2026-09-25T03:00:00Z'),
      },
    ]);
    const spend = await budgetSpend(db, 'user-1', [
      { id: 'whole', categoryId: 'food', currency: 'VND', range: RANGE },
      {
        id: 'clipped',
        categoryId: 'food',
        currency: 'VND',
        range: { from: new Date('2026-09-19T17:00:00Z'), to: RANGE.to },
      },
      { id: 'none', categoryId: 'rent', currency: 'VND', range: RANGE },
    ]);
    expect(spend.get('whole')?.toString()).toBe('107');
    expect(spend.get('clipped')?.toString()).toBe('7');
    expect(spend.get('none')?.toString()).toBe('0');
  });

  it('queries once per distinct range and not at all without budgets', async () => {
    const { db, groupBy } = fakeDb([]);
    await budgetSpend(db, 'user-1', []);
    expect(groupBy).not.toHaveBeenCalled();
    await budgetSpend(db, 'user-1', [
      { id: 'a', categoryId: 'food', currency: 'VND', range: RANGE },
      { id: 'b', categoryId: null, currency: 'VND', range: { ...RANGE } },
    ]);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});
