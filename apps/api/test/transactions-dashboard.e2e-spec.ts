import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  registerUser,
} from './helpers/auth-fixtures';
import { createTestApp } from './helpers/test-app';

jest.setTimeout(120_000);

type Totals = {
  currency: string;
  income: number;
  expense: number;
  netCashflow: number;
  transactionCount: number;
};
type Overview = Totals & {
  month: string;
  savingRate: number;
  unreadAlerts: number;
  currencies: Totals[];
  periodStart: string;
  periodEnd: string;
  timeZone: string;
};
type ListResponse = {
  data: Array<{ id: string }>;
  total: number;
  totals: Totals & { currencies: Totals[] };
};
type BreakdownRow = {
  categoryId: string | null;
  category: { id: string; status: string } | null;
  currency: string;
  amount: number;
  count: number;
  direction?: string;
};

const money = (
  currency: string,
  income: number,
  expense: number,
  count: number,
) => ({
  currency,
  income,
  expense,
  netCashflow: Number((income - expense).toFixed(2)),
  transactionCount: count,
});

/**
 * T036 (DASH-001–DASH-003, TEST-004, SC-009, TX-003, TX-005): one canonical
 * ledger, entered through the API, whose hand-calculated totals every
 * transaction and dashboard view must agree on, before and after edits.
 * All instants carry explicit offsets and every query names its month, so the
 * suite never depends on the current date.
 */
describe('Transactions to dashboard: canonical ledger (T036)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser | undefined;
  const ids: Record<string, string> = {};
  const categories: Record<string, string> = {};

  const JUNE = '2026-06';

  const create = async (
    user: TestUser,
    key: string,
    body: Record<string, unknown>,
  ) => {
    const response = await user.agent
      .post('/api/transactions')
      .send({ description: `T036 ${key}`, ...body })
      .expect(201);
    ids[key] = dataOf<{ id: string }>(response).id;
  };
  const get = async <T>(user: TestUser, path: string, query = {}) =>
    dataOf<T>(await user.agent.get(path).query(query).expect(200));
  const overview = (user: TestUser, month: string) =>
    get<Overview>(user, '/api/dashboard/overview', { month });
  const list = (user: TestUser, query: Record<string, string>) =>
    get<ListResponse>(user, '/api/transactions', { limit: '100', ...query });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 't036-alice');
    bob = await registerUser(app, 't036-bob');

    for (const [key, body] of Object.entries({
      food: { name: 'T036 Food' },
      travel: { name: 'T036 Travel' },
      excluded: { name: 'T036 Excluded', excludeFromAnalytics: true },
      salary: { name: 'T036 Salary', type: 'INCOME' },
    })) {
      categories[key] = dataOf<{ id: string }>(
        await alice.agent
          .post('/api/transaction-categories')
          .send({ ...body, name: `${body.name} ${Date.now()}` })
          .expect(201),
      ).id;
    }

    // Canonical ledger (Asia/Ho_Chi_Minh, month-start day 1, base VND).
    const vnd = (
      amount: number,
      direction: string,
      at: string,
      extra = {},
    ) => ({
      amount,
      currency: 'VND',
      direction,
      transactionTime: at,
      ...extra,
    });
    await create(
      alice,
      'T1',
      vnd(30_000_000, 'INCOME', '2026-06-05T09:00:00+07:00', {
        categoryId: categories.salary,
      }),
    );
    await create(
      alice,
      'T2',
      vnd(1_200_000, 'EXPENSE', '2026-06-01T00:00:00+07:00', {
        categoryId: categories.food,
      }),
    );
    await create(
      alice,
      'T3',
      vnd(800_000, 'EXPENSE', '2026-05-31T23:59:59+07:00', {
        categoryId: categories.food,
      }),
    );
    await create(
      alice,
      'T4',
      vnd(2_500_000, 'EXPENSE', '2026-06-30T23:59:59+07:00', {
        categoryId: categories.travel,
      }),
    );
    await create(
      alice,
      'T5',
      vnd(700_000, 'EXPENSE', '2026-07-01T00:00:00+07:00', {
        categoryId: categories.travel,
      }),
    );
    await create(
      alice,
      'T6',
      vnd(450_000, 'EXPENSE', '2026-06-10T12:00:00+07:00'),
    );
    await create(
      alice,
      'T7',
      vnd(300_000, 'EXPENSE', '2026-06-11T12:00:00+07:00', {
        categoryId: categories.excluded,
      }),
    );
    await create(
      alice,
      'T8',
      vnd(5_000_000, 'TRANSFER_OUT', '2026-06-12T10:00:00+07:00'),
    );
    await create(
      alice,
      'T9',
      vnd(5_000_000, 'TRANSFER_IN', '2026-06-12T11:00:00+07:00'),
    );
    await create(
      alice,
      'T10',
      vnd(999_000, 'EXPENSE', '2026-06-13T12:00:00+07:00', {
        status: 'PENDING',
      }),
    );
    await create(
      alice,
      'T11',
      vnd(888_000, 'EXPENSE', '2026-06-14T12:00:00+07:00', {
        status: 'NEEDS_REVIEW',
      }),
    );
    await create(
      alice,
      'T12',
      vnd(777_000, 'EXPENSE', '2026-06-15T12:00:00+07:00'),
    );
    await create(
      alice,
      'T13',
      vnd(1_200_000, 'EXPENSE', '2026-06-16T12:00:00+07:00', {
        categoryId: categories.food,
      }),
    );
    await create(
      alice,
      'T14',
      vnd(666_000, 'EXPENSE', '2026-06-17T12:00:00+07:00', {
        categoryId: categories.food,
      }),
    );
    await create(alice, 'T15', {
      amount: 12.04,
      currency: 'USD',
      direction: 'EXPENSE',
      transactionTime: '2026-06-18T12:00:00+07:00',
      categoryId: categories.travel,
    });
    await create(alice, 'T16', {
      amount: 0.3,
      currency: 'USD',
      direction: 'EXPENSE',
      transactionTime: '2026-06-19T12:00:00+07:00',
    });
    await create(alice, 'T17', {
      amount: 100.1,
      currency: 'USD',
      direction: 'INCOME',
      transactionTime: '2026-06-20T12:00:00+07:00',
    });
    await create(
      alice,
      'T18',
      vnd(100_000, 'ADJUSTMENT', '2026-06-21T12:00:00+07:00'),
    );
    await create(
      alice,
      'T19',
      vnd(4_000_000, 'INCOME', '2026-04-10T10:00:00+07:00'),
    );

    await alice.agent.patch(`/api/transactions/${ids.T12}/ignore`).expect(200);
    await alice.agent
      .patch(`/api/transactions/${ids.T13}/duplicate`)
      .send({ duplicateOfTransactionId: ids.T2 })
      .expect(200);
    await alice.agent.delete(`/api/transactions/${ids.T14}`).expect(200);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupUsers(prisma, [alice?.id, bob?.id, carol?.id]);
    }
    await app?.close();
  });

  describe('June totals (hand-calculated)', () => {
    // VND income: T1 30,000,000. VND expense: T2 1,200,000 + T4 2,500,000 +
    // T6 450,000 + T7 300,000 = 4,450,000. Excluded: T3 (May), T5 (July),
    // T8/T9 transfers, T10 pending, T11 needs review, T12 ignored, T13
    // duplicate, T14 deleted, T18 adjustment. USD: 100.10 − (12.04 + 0.30).
    const JUNE_VND = money('VND', 30_000_000, 4_450_000, 8);
    const JUNE_USD = money('USD', 100.1, 12.34, 3);

    it('overview: base currency figures, other currencies separate', async () => {
      expect(await overview(alice, JUNE)).toEqual({
        month: JUNE,
        currency: 'VND',
        income: 30_000_000,
        expense: 4_450_000,
        netCashflow: 25_550_000,
        savingRate: 85,
        transactionCount: 11,
        unreadAlerts: 0,
        currencies: [JUNE_USD, JUNE_VND],
        periodStart: '2026-05-31T17:00:00.000Z',
        periodEnd: '2026-06-30T17:00:00.000Z',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
    });

    it('is identical on every read (DASH-003)', async () => {
      expect(await overview(alice, JUNE)).toEqual(await overview(alice, JUNE));
    });

    it('the transaction list totals equal the dashboard for the same month', async () => {
      const page = await list(alice, { month: JUNE });
      // Visible June rows: all but T14 (deleted), T3 (May), T5 (July).
      expect(page.total).toBe(15);
      expect(page.data.map((row) => row.id)).not.toContain(ids.T14);
      const dashboard = await overview(alice, JUNE);
      expect(page.totals).toEqual({
        currency: dashboard.currency,
        income: dashboard.income,
        expense: dashboard.expense,
        netCashflow: dashboard.netCashflow,
        transactionCount: dashboard.transactionCount,
        currencies: dashboard.currencies,
      });
    });

    it('list totals follow the list filters, not the page', async () => {
      const expenses = await list(alice, {
        month: JUNE,
        direction: 'EXPENSE',
        limit: '2',
      });
      expect(expenses.total).toBe(10);
      expect(expenses.data).toHaveLength(2);
      expect(expenses.totals).toEqual({
        ...money('VND', 0, 4_450_000, 6),
        currencies: [money('USD', 0, 12.34, 2), money('VND', 0, 4_450_000, 4)],
      });

      const food = await list(alice, {
        month: JUNE,
        categoryId: categories.food,
      });
      expect(food.data.map((row) => row.id).sort()).toEqual(
        [ids.T2, ids.T13].sort(),
      );
      expect(food.totals).toMatchObject({ expense: 1_200_000 });

      const deleted = await list(alice, { status: 'DELETED' });
      expect(deleted.total).toBe(0);
      expect(deleted.data).toEqual([]);
      expect(deleted.totals).toEqual({
        ...money('VND', 0, 0, 0),
        currencies: [],
      });
    });

    it('category breakdown adds up to the eligible expense, uncategorized included', async () => {
      const rows = await get<BreakdownRow[]>(
        alice,
        '/api/dashboard/category-breakdown',
        { month: JUNE },
      );
      expect(
        rows.map(({ categoryId, currency, amount, count }) => ({
          categoryId,
          currency,
          amount,
          count,
        })),
      ).toEqual([
        {
          categoryId: categories.travel,
          currency: 'VND',
          amount: 2_500_000,
          count: 1,
        },
        {
          categoryId: categories.food,
          currency: 'VND',
          amount: 1_200_000,
          count: 1,
        },
        { categoryId: null, currency: 'VND', amount: 450_000, count: 1 },
        {
          categoryId: categories.excluded,
          currency: 'VND',
          amount: 300_000,
          count: 1,
        },
        {
          categoryId: categories.travel,
          currency: 'USD',
          amount: 12.04,
          count: 1,
        },
        { categoryId: null, currency: 'USD', amount: 0.3, count: 1 },
      ]);
    });

    it('cashflow trend has one entry per user month, empty months included', async () => {
      expect(
        await get(alice, '/api/dashboard/cashflow', { months: 4, month: JUNE }),
      ).toEqual([
        {
          month: '2026-03',
          currency: 'VND',
          income: 0,
          expense: 0,
          netCashflow: 0,
        },
        {
          month: '2026-04',
          currency: 'VND',
          income: 4_000_000,
          expense: 0,
          netCashflow: 4_000_000,
        },
        {
          month: '2026-05',
          currency: 'VND',
          income: 0,
          expense: 800_000,
          netCashflow: -800_000,
        },
        {
          month: '2026-06',
          currency: 'VND',
          income: 30_000_000,
          expense: 4_450_000,
          netCashflow: 25_550_000,
        },
      ]);
    });

    it('recent transactions are the newest eligible rows of the month', async () => {
      const recent = await get<Array<{ id: string }>>(
        alice,
        '/api/dashboard/recent-transactions',
        { month: JUNE },
      );
      expect(recent.map((row) => row.id)).toEqual([
        ids.T4,
        ids.T18,
        ids.T17,
        ids.T16,
        ids.T15,
      ]);
    });

    it('hot budgets spend eligible expense in the budget currency and category', async () => {
      const budget = (body: Record<string, unknown>) =>
        alice.agent
          .post('/api/budgets')
          .send({
            period: 'MONTHLY',
            startsAt: '2026-06-01T00:00:00+07:00',
            thresholdPercent: 80,
            ...body,
          })
          .expect(201);
      await budget({
        name: 'T036 food',
        amount: 1_000_000,
        currency: 'VND',
        categoryId: categories.food,
      });
      await budget({
        name: 'T036 travel USD',
        amount: 10,
        currency: 'USD',
        categoryId: categories.travel,
      });
      await budget({
        name: 'T036 travel VND',
        amount: 5_000_000,
        currency: 'VND',
        categoryId: categories.travel,
      });

      const hot = await get<Array<{ name: string } & Record<string, unknown>>>(
        alice,
        '/api/dashboard/hot-budgets',
        { month: JUNE },
      );
      const byName = new Map(hot.map((entry) => [entry.name, entry]));
      expect([...byName.keys()].sort()).toEqual([
        'T036 food',
        'T036 travel USD',
      ]);
      // Food: T2 only (T13 duplicate and T14 deleted excluded).
      expect(byName.get('T036 food')).toMatchObject({
        currency: 'VND',
        amount: 1_000_000,
        spent: 1_200_000,
        remaining: 0,
        percentUsed: 120,
      });
      // USD travel: T15 only; the VND travel expense is another currency.
      expect(byName.get('T036 travel USD')).toMatchObject({
        currency: 'USD',
        amount: 10,
        spent: 12.04,
        remaining: 0,
        percentUsed: 120,
      });
    });

    it('analytics agrees with the dashboard', async () => {
      const summary = await get<Overview & { savingsRate: number }>(
        alice,
        '/api/analytics/monthly-summary',
        { month: JUNE },
      );
      const dashboard = await overview(alice, JUNE);
      expect(summary).toMatchObject({
        month: JUNE,
        currency: 'VND',
        income: dashboard.income,
        expense: dashboard.expense,
        netCashflow: dashboard.netCashflow,
        transactionCount: dashboard.transactionCount,
        currencies: dashboard.currencies,
        periodStart: dashboard.periodStart,
        periodEnd: dashboard.periodEnd,
      });
      expect(summary.savingsRate).toBeCloseTo(25_550_000 / 30_000_000, 12);

      const rows = await get<BreakdownRow[]>(
        alice,
        '/api/analytics/category-breakdown',
        { month: JUNE },
      );
      const sum = (currency: string, direction: string) =>
        rows
          .filter(
            (row) => row.currency === currency && row.direction === direction,
          )
          .reduce((total, row) => total + Math.round(row.amount * 100), 0) /
        100;
      expect(sum('VND', 'EXPENSE')).toBe(4_450_000);
      expect(sum('VND', 'INCOME')).toBe(30_000_000);
      expect(sum('USD', 'EXPENSE')).toBe(12.34);
      expect(sum('USD', 'INCOME')).toBe(100.1);
      // Transfers and adjustments stay visible as their own directions.
      expect(sum('VND', 'TRANSFER_OUT')).toBe(5_000_000);
      expect(sum('VND', 'TRANSFER_IN')).toBe(5_000_000);
      expect(sum('VND', 'ADJUSTMENT')).toBe(100_000);

      expect(
        await get(alice, '/api/analytics/cashflow', {
          from: '2026-05-31T17:00:00.000Z',
          to: '2026-06-30T17:00:00.000Z',
        }),
      ).toEqual([
        {
          date: '2026-06-01',
          currency: 'VND',
          income: 0,
          expense: 1_200_000,
          netCashflow: -1_200_000,
        },
        {
          date: '2026-06-05',
          currency: 'VND',
          income: 30_000_000,
          expense: 0,
          netCashflow: 30_000_000,
        },
        {
          date: '2026-06-10',
          currency: 'VND',
          income: 0,
          expense: 450_000,
          netCashflow: -450_000,
        },
        {
          date: '2026-06-11',
          currency: 'VND',
          income: 0,
          expense: 300_000,
          netCashflow: -300_000,
        },
        {
          date: '2026-06-30',
          currency: 'VND',
          income: 0,
          expense: 2_500_000,
          netCashflow: -2_500_000,
        },
      ]);
    });
  });

  describe('recalculation after edits (TX-005)', () => {
    it('moving a transaction across the month boundary moves its amount', async () => {
      const julyBefore = await overview(alice, '2026-07');
      expect(julyBefore.expense).toBe(700_000);

      await alice.agent
        .patch(`/api/transactions/${ids.T4}`)
        .send({ transactionTime: '2026-07-01T00:00:00+07:00' })
        .expect(200);

      const june = await overview(alice, JUNE);
      const july = await overview(alice, '2026-07');
      expect(june.expense).toBe(1_950_000);
      expect(july.expense).toBe(3_200_000);
      expect(june.expense + july.expense).toBe(4_450_000 + 700_000);
    });

    it('restoring an ignored transaction and recategorizing update every view', async () => {
      await alice.agent
        .patch(`/api/transactions/${ids.T12}`)
        .send({ status: 'POSTED' })
        .expect(200);
      await alice.agent
        .patch(`/api/transactions/${ids.T6}/category`)
        .send({ categoryId: categories.food })
        .expect(200);

      // June VND expense: T2 1,200,000 + T6 450,000 + T7 300,000 + T12 777,000.
      expect(await overview(alice, JUNE)).toMatchObject({
        income: 30_000_000,
        expense: 2_727_000,
        netCashflow: 27_273_000,
      });
      const rows = await get<BreakdownRow[]>(
        alice,
        '/api/dashboard/category-breakdown',
        { month: JUNE },
      );
      expect(
        rows
          .filter((row) => row.currency === 'VND')
          .map((row) => [row.categoryId, row.amount]),
      ).toEqual([
        [categories.food, 1_650_000],
        [null, 777_000],
        [categories.excluded, 300_000],
      ]);
    });

    it('releasing a duplicate counts it again; a deleted row never returns', async () => {
      await alice.agent
        .patch(`/api/transactions/${ids.T13}/duplicate`)
        .send({})
        .expect(200);
      await alice.agent.delete(`/api/transactions/${ids.T1}`).expect(200);

      // Adds T13 1,200,000; T14 (deleted 666,000) and T1 (now deleted) stay out.
      const june = await overview(alice, JUNE);
      expect(june).toMatchObject({
        income: 0,
        expense: 3_927_000,
        netCashflow: -3_927_000,
        savingRate: 0,
      });
      const page = await list(alice, { month: JUNE });
      expect(page.totals).toMatchObject({
        income: june.income,
        expense: june.expense,
        netCashflow: june.netCashflow,
        transactionCount: june.transactionCount,
      });
    });

    it('archiving a category keeps its history in the breakdown', async () => {
      await alice.agent
        .delete(`/api/transaction-categories/${categories.travel}`)
        .expect(200);
      const rows = await get<BreakdownRow[]>(
        alice,
        '/api/dashboard/category-breakdown',
        { month: JUNE },
      );
      const travel = rows.find(
        (row) => row.categoryId === categories.travel && row.currency === 'USD',
      );
      expect(travel).toMatchObject({ amount: 12.04, count: 1 });
      expect(travel?.category?.status).toBe('ARCHIVED');
    });
  });

  describe('user timezone and month-start day (DASH-002)', () => {
    beforeAll(async () => {
      await bob.agent
        .patch('/api/users/me')
        .send({ timezone: 'America/New_York', baseCurrency: 'USD' })
        .expect(200);
      await bob.agent
        .patch('/api/users/me/settings')
        .send({ defaultMonthStartDay: 25 })
        .expect(200);
      const usd = (amount: number, direction: string, at: string) => ({
        amount,
        currency: 'USD',
        direction,
        transactionTime: at,
      });
      await create(bob, 'B1', usd(100, 'EXPENSE', '2026-10-24T23:59:59-04:00'));
      await create(bob, 'B2', usd(200, 'EXPENSE', '2026-10-25T00:00:00-04:00'));
      await create(bob, 'B3', usd(1000, 'INCOME', '2026-11-24T23:59:59-05:00'));
      await create(bob, 'B4', usd(50, 'EXPENSE', '2026-11-25T00:00:00-05:00'));
      await create(bob, 'B5', {
        amount: 70_000,
        currency: 'VND',
        direction: 'EXPENSE',
        transactionTime: '2026-11-01T12:00:00-05:00',
      });
    });

    it('a month starts on day 25 at local midnight, across the DST change', async () => {
      expect(await overview(bob, '2026-10')).toEqual({
        month: '2026-10',
        currency: 'USD',
        income: 1000,
        expense: 200,
        netCashflow: 800,
        savingRate: 80,
        transactionCount: 3,
        unreadAlerts: 0,
        currencies: [money('USD', 1000, 200, 2), money('VND', 0, 70_000, 1)],
        periodStart: '2026-10-25T04:00:00.000Z',
        periodEnd: '2026-11-25T05:00:00.000Z',
        timeZone: 'America/New_York',
      });
      expect(await overview(bob, '2026-09')).toMatchObject({
        expense: 100,
        periodStart: '2026-09-25T04:00:00.000Z',
        periodEnd: '2026-10-25T04:00:00.000Z',
      });
      expect(await overview(bob, '2026-11')).toMatchObject({ expense: 50 });
    });

    it('the list month uses the same user month', async () => {
      const page = await list(bob, { month: '2026-10' });
      expect(page.data.map((row) => row.id).sort()).toEqual(
        [ids.B2, ids.B3, ids.B5].sort(),
      );
      expect(page.totals).toEqual({
        ...money('USD', 1000, 200, 3),
        currencies: [money('USD', 1000, 200, 2), money('VND', 0, 70_000, 1)],
      });
    });

    it("never mixes another user's ledger", async () => {
      expect(await overview(bob, JUNE)).toMatchObject({
        income: 0,
        expense: 0,
        transactionCount: 0,
        currencies: [],
      });
    });
  });

  describe('stored currency codes that differ only in case', () => {
    it('fold into one currency group, the base currency included', async () => {
      carol = await registerUser(app, 't036-carol');
      // Written before T034, when a lower-case code was still accepted.
      await prisma.transaction.create({
        data: {
          userId: carol.id,
          amount: 250_000,
          currency: 'vnd',
          direction: 'EXPENSE',
          transactionTime: new Date('2026-06-10T05:00:00.000Z'),
          status: 'POSTED',
        },
      });
      await create(carol, 'C1', {
        amount: 1_000_000,
        currency: 'VND',
        direction: 'INCOME',
        transactionTime: '2026-06-11T12:00:00+07:00',
      });

      expect(await overview(carol, JUNE)).toMatchObject({
        currency: 'VND',
        income: 1_000_000,
        expense: 250_000,
        netCashflow: 750_000,
        currencies: [money('VND', 1_000_000, 250_000, 2)],
      });
      const rows = await get<BreakdownRow[]>(
        carol,
        '/api/dashboard/category-breakdown',
        { month: JUNE },
      );
      expect(
        rows.map(({ categoryId, currency, amount }) => ({
          categoryId,
          currency,
          amount,
        })),
      ).toEqual([{ categoryId: null, currency: 'VND', amount: 250_000 }]);
      expect(
        await get(carol, '/api/dashboard/cashflow', { months: 1, month: JUNE }),
      ).toEqual([
        {
          month: JUNE,
          currency: 'VND',
          income: 1_000_000,
          expense: 250_000,
          netCashflow: 750_000,
        },
      ]);
    });
  });
});
