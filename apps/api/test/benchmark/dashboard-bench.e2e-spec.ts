import { createTestApp } from '../helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { Envelope, dataOf, syntheticPassword } from '../helpers/auth-fixtures';
import {
  IsolatedDatabase,
  createIsolatedDatabase,
  dropIsolatedDatabase,
} from '../helpers/test-database';
import {
  BENCH_EMAIL,
  BENCH_MONTH_MIX,
  BENCH_SEED,
  BenchTransaction,
  DashboardBenchFixture,
  benchToday,
  generateDashboardBenchFixture,
  parseMinor,
} from './dashboard-bench.fixture';
import {
  BenchRefusedError,
  DASHBOARD_LOAD_PATHS,
  loadStats,
  runDashboardBenchmark,
  seedDashboardBench,
} from './dashboard-benchmark';

jest.setTimeout(300_000);

const HOUR = 3_600_000;
/** A mid-month anchor, a year-crossing one, a first-of-month one, a leap day. */
const ANCHORS = ['2026-09-24', '2026-01-15', '2026-03-01', '2028-02-29'];

type Mix = Record<keyof typeof BENCH_MONTH_MIX, number>;

const emptyMix = (): Mix => ({
  vndExpenses: 0,
  usdExpenses: 0,
  incomes: 0,
  transfersOut: 0,
  transfersIn: 0,
  ignored: 0,
  duplicates: 0,
  deleted: 0,
});

/** Classifies each record into its DASH-004 bucket; unknown shapes throw. */
function mixOf(rows: BenchTransaction[]): Mix {
  const mix = emptyMix();
  for (const row of rows) {
    if (row.status === 'DELETED') {
      mix.deleted++;
    } else if (row.status === 'IGNORED') {
      mix.ignored++;
    } else if (row.isDuplicate) {
      mix.duplicates++;
    } else if (row.direction === 'EXPENSE' && row.currency === 'VND') {
      mix.vndExpenses++;
    } else if (row.direction === 'EXPENSE' && row.currency === 'USD') {
      mix.usdExpenses++;
    } else if (row.direction === 'INCOME' && row.currency === 'VND') {
      mix.incomes++;
    } else if (row.direction === 'TRANSFER_OUT' && row.currency === 'VND') {
      mix.transfersOut++;
    } else if (row.direction === 'TRANSFER_IN' && row.currency === 'VND') {
      mix.transfersIn++;
    } else {
      throw new Error(`Unexpected record ${row.id}`);
    }
  }
  return mix;
}

/** A third, BigInt-based computation of the current-month totals. */
function recomputeCurrentMonth(fixture: DashboardBenchFixture) {
  const current = fixture.months[fixture.months.length - 1];
  const rows = fixture.transactions.filter(
    (row) =>
      row.transactionTime >= current.from && row.transactionTime < current.to,
  );
  const groups: Record<
    string,
    { income: bigint; expense: bigint; count: number }
  > = {};
  for (const row of rows.filter((r) => r.status === 'POSTED')) {
    if (row.isDuplicate) {
      continue;
    }
    const group = (groups[row.currency] ??= {
      income: 0n,
      expense: 0n,
      count: 0,
    });
    group.count++;
    const cents = BigInt(row.amount.replace('.', ''));
    if (row.direction === 'INCOME') {
      group.income += cents;
    } else if (row.direction === 'EXPENSE') {
      group.expense += cents;
    }
  }
  return {
    total: rows.length,
    groups: Object.keys(groups)
      .sort()
      .map((currency) => ({
        currency,
        incomeMinor: Number(groups[currency].income),
        expenseMinor: Number(groups[currency].expense),
        netMinor: Number(groups[currency].income - groups[currency].expense),
        eligibleCount: groups[currency].count,
      })),
  };
}

/**
 * T036 (DASH-004, SC-010): the reference benchmark's deterministic fixture,
 * its seeder, and its runner. The gating 200-load run is T101's; here the
 * runner only proves it works end to end.
 */
describe('Dashboard benchmark fixture (T036, DASH-004)', () => {
  it('yields byte-identical records and expected totals for the same seed and anchor', () => {
    const first = generateDashboardBenchFixture('2026-09-24');
    const second = generateDashboardBenchFixture('2026-09-24');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(second.expected)).toBe(
      JSON.stringify(first.expected),
    );
    expect(first.seed).toBe(20260923);
    expect(BENCH_SEED).toBe(20260923);

    // The seed really drives the data.
    const otherSeed = generateDashboardBenchFixture('2026-09-24', 20260924);
    expect(JSON.stringify(otherSeed.transactions)).not.toBe(
      JSON.stringify(first.transactions),
    );
    expect(otherSeed.expected).not.toEqual(first.expected);

    // Another day of the same month only moves current-month timestamps: the
    // expected totals depend on the seed and the anchor's month alone.
    const sameMonth = generateDashboardBenchFixture('2026-09-02');
    const times = (fixture: DashboardBenchFixture) =>
      fixture.transactions.map((row) => row.transactionTime);
    expect(times(sameMonth)).not.toEqual(times(first));
    expect(sameMonth.expected).toEqual(first.expected);
    // Another month shifts the 13-month window and the expected period.
    const nextMonth = generateDashboardBenchFixture('2026-10-24');
    expect(nextMonth.months[0].key).toBe('2025-10');
    expect(nextMonth.expected).toMatchObject({
      month: '2026-10',
      periodStart: '2026-09-30T17:00:00.000Z',
      periodEnd: '2026-10-31T17:00:00.000Z',
    });
  });

  it.each(ANCHORS)(
    'has the DASH-004 shape for anchor %s: 13 months × 230, 2,990 in total',
    (anchor) => {
      const fixture = generateDashboardBenchFixture(anchor);
      const { months, transactions } = fixture;

      // 13 consecutive user months ending with the anchor's month, starting
      // at local midnight on day 1 in Asia/Ho_Chi_Minh (UTC+07:00).
      expect(months).toHaveLength(13);
      expect(months.map((month) => month.current)).toEqual([
        ...Array<boolean>(12).fill(false),
        true,
      ]);
      expect(months[12].key).toBe(anchor.slice(0, 7));
      for (const [index, month] of months.entries()) {
        const local = new Date(Date.parse(month.from) + 7 * HOUR);
        expect(local.toISOString()).toBe(`${month.key}-01T00:00:00.000Z`);
        if (index > 0) {
          expect(month.from).toBe(months[index - 1].to);
        }
        if (!month.current) {
          expect(month.spreadTo).toBe(month.to);
        }
      }
      const anchorDayEnd = new Date(
        Date.parse(`${anchor}T00:00:00.000Z`) + 24 * HOUR - 7 * HOUR,
      ).toISOString();
      expect(months[12].spreadTo).toBe(anchorDayEnd);

      const expectedMix: Mix = { ...BENCH_MONTH_MIX };
      const byId = new Map(transactions.map((row) => [row.id, row]));
      for (const month of months) {
        const rows = transactions.filter(
          (row) =>
            row.transactionTime >= month.from && row.transactionTime < month.to,
        );
        expect({ month: month.key, count: rows.length }).toEqual({
          month: month.key,
          count: 230,
        });
        expect(mixOf(rows)).toEqual(expectedMix);
        for (const row of rows) {
          expect(row.transactionTime < month.spreadTo).toBe(true);
        }
        // Each duplicate copies a distinct eligible VND expense of its month.
        const duplicates = rows.filter((row) => row.isDuplicate);
        const originals = duplicates.map((row) =>
          byId.get(row.duplicateOfTransactionId ?? ''),
        );
        expect(new Set(originals.map((row) => row?.id)).size).toBe(3);
        duplicates.forEach((duplicate, index) => {
          const original = originals[index];
          expect(original).toMatchObject({
            status: 'POSTED',
            isDuplicate: false,
            direction: 'EXPENSE',
            currency: 'VND',
            amount: duplicate.amount,
            transactionTime: duplicate.transactionTime,
          });
          expect(duplicate.status).toBe('POSTED');
        });
      }

      expect(transactions).toHaveLength(2990);
      expect(new Set(transactions.map((row) => row.id)).size).toBe(2990);
      for (const row of transactions) {
        expect(row.amount).toMatch(
          row.currency === 'VND' ? /^[1-9]\d*000\.00$/ : /^\d+\.\d{2}$/,
        );
        expect(parseMinor(row.amount)).toBeGreaterThan(0);
        expect(row.userId).toBe(fixture.user.id);
      }

      // 20 categories (15 expense, 5 income), 3 accounts, 10 budgets.
      const { categories, accounts, budgets } = fixture;
      expect(categories).toHaveLength(20);
      expect(categories.filter((c) => c.type === 'EXPENSE')).toHaveLength(15);
      expect(categories.filter((c) => c.type === 'INCOME')).toHaveLength(5);
      expect(new Set(categories.map((c) => c.slug)).size).toBe(20);
      expect(accounts.map((account) => account.type)).toEqual([
        'CHECKING',
        'E_WALLET',
        'CASH',
      ]);
      expect(budgets).toHaveLength(10);
      const expenseIds = new Set(
        categories.filter((c) => c.type === 'EXPENSE').map((c) => c.id),
      );
      expect(new Set(budgets.map((budget) => budget.categoryId)).size).toBe(10);
      for (const budget of budgets) {
        expect(expenseIds.has(budget.categoryId)).toBe(true);
        expect(budget).toMatchObject({
          period: 'MONTHLY',
          isActive: true,
          endsAt: null,
          currency: 'VND',
          startsAt: months[0].from,
        });
      }
      const categoryIds = new Set(categories.map((c) => c.id));
      const accountIds = new Set(accounts.map((a) => a.id));
      for (const row of transactions) {
        expect(row.categoryId === null || categoryIds.has(row.categoryId)).toBe(
          true,
        );
        expect(accountIds.has(row.financialAccountId)).toBe(true);
      }
      expect(fixture.user).toMatchObject({
        email: BENCH_EMAIL,
        timezone: 'Asia/Ho_Chi_Minh',
        baseCurrency: 'VND',
      });
      expect(fixture.settings.defaultMonthStartDay).toBe(1);

      // Expected totals agree with an independent recomputation.
      const recomputed = recomputeCurrentMonth(fixture);
      expect(fixture.expected.totalCount).toBe(230);
      expect(recomputed.total).toBe(230);
      expect(fixture.expected.currencies).toEqual(recomputed.groups);
      expect(fixture.expected.eligibleCount).toBe(220);
      expect(
        fixture.expected.currencies.map((group) => [
          group.currency,
          group.eligibleCount,
        ]),
      ).toEqual([
        ['USD', 5],
        ['VND', 215],
      ]);
      const [usd, vnd] = fixture.expected.overview.currencies;
      expect(usd.income).toBe(0);
      expect(usd.netCashflow).toBe(-usd.expense);
      expect(fixture.expected.overview).toMatchObject({
        month: anchor.slice(0, 7),
        currency: 'VND',
        income: vnd.income,
        expense: vnd.expense,
        netCashflow: vnd.netCashflow,
        transactionCount: 220,
        periodStart: months[12].from,
        periodEnd: months[12].to,
      });
    },
  );

  it('reports nearest-rank percentiles: p95 of 200 loads is the 190th value', () => {
    const durations = Array.from({ length: 200 }, (_, index) => 200 - index);
    expect(loadStats(durations)).toEqual({
      count: 200,
      minMs: 1,
      medianMs: 100,
      p95Ms: 190,
      maxMs: 200,
    });
    expect(loadStats([5, 1, 3]).p95Ms).toBe(5);
    expect(DASHBOARD_LOAD_PATHS).toEqual([
      '/dashboard/overview',
      '/dashboard/cashflow?months=6',
      '/dashboard/category-breakdown',
      '/dashboard/recent-transactions',
      '/dashboard/hot-budgets',
      '/dashboard/insights',
    ]);
  });

  it('computes the benchmark day in Asia/Ho_Chi_Minh (UTC+07:00)', () => {
    expect(benchToday(new Date('2026-09-23T16:59:59.999Z'))).toBe('2026-09-23');
    expect(benchToday(new Date('2026-09-23T17:00:00.000Z'))).toBe('2026-09-24');
    expect(() => generateDashboardBenchFixture('2026-02-30')).toThrow(
      /not a calendar date/,
    );
  });

  it('the runner fails with exit 4 when the API never becomes ready', async () => {
    const result = await runDashboardBenchmark({
      baseUrl: 'http://127.0.0.1:9/api',
      email: BENCH_EMAIL,
      password: 'unused-password',
      anchor: '2026-09-24',
      warmup: 0,
      loads: 1,
      readyTimeoutMs: 1,
      log: () => undefined,
    });
    expect(result).toMatchObject({
      exitCode: 4,
      totalsMatched: false,
      failures: ['readiness: /health/ready never returned 200'],
      durationsMs: [],
    });
  });
});

/**
 * The seeder and runner against the real application. The fixture is seeded
 * into an isolated database (the seeder refuses any database holding other
 * accounts), and one in-process app is built against it: PrismaService reads
 * DATABASE_URL when the app is built.
 */
/** Waits past the next Asia/Ho_Chi_Minh month start when it is under 10 minutes away. */
async function awayFromMonthEnd(): Promise<void> {
  const offset = 7 * 3_600_000; // UTC+07:00 all year (no daylight saving)
  const local = new Date(Date.now() + offset);
  const nextStart =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - offset;
  const remaining = nextStart - Date.now();
  if (remaining < 10 * 60_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 5_000));
  }
}

describe('Dashboard benchmark against the API (T036, isolated database)', () => {
  const sharedUrl = process.env.DATABASE_URL;
  const password = syntheticPassword();
  let database: IsolatedDatabase | undefined;
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let anchor: string;
  let fixture: DashboardBenchFixture;
  let passwordHash: string;

  beforeAll(async () => {
    // The API resolves "current month" from its own clock, so the suite must
    // not straddle a local month end: within 10 minutes of one, wait for it.
    await awayFromMonthEnd();
    database = await createIsolatedDatabase('dashboard_bench');
    process.env.DATABASE_URL = database.url;
    app = await createTestApp();
    prisma = app.get(PrismaService);
    anchor = benchToday(new Date());
    fixture = generateDashboardBenchFixture(anchor);
    passwordHash = await bcrypt.hash(password, 12);
  }, 12 * 60_000);

  afterAll(async () => {
    await app?.close();
    process.env.DATABASE_URL = sharedUrl;
    if (database) {
      await dropIsolatedDatabase(database.name);
    }
  });

  const server = () => app!.getHttpServer();

  it('refuses a database that holds any other account', async () => {
    const other = await prisma.user.create({
      data: { email: 'bench-other@example.test' },
    });
    try {
      await expect(
        seedDashboardBench(prisma, fixture, passwordHash),
      ).rejects.toBeInstanceOf(BenchRefusedError);
      expect(await prisma.transaction.count()).toBe(0);
      expect(await prisma.user.count({ where: { email: BENCH_EMAIL } })).toBe(
        0,
      );
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it('seeds the fixture, and re-seeding replaces it (idempotent)', async () => {
    const counts = {
      users: 1,
      categories: 20,
      accounts: 3,
      budgets: 10,
      transactions: 2990,
    };
    expect(await seedDashboardBench(prisma, fixture, passwordHash)).toEqual(
      counts,
    );
    expect(await seedDashboardBench(prisma, fixture, passwordHash)).toEqual(
      counts,
    );
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.transaction.count()).toBe(2990);
    expect(
      await prisma.transaction.count({ where: { isDuplicate: true } }),
    ).toBe(39);
    expect(
      await prisma.transaction.count({ where: { status: 'DELETED' } }),
    ).toBe(39);
  });

  it('GET /api/dashboard/overview for the current month equals the fixture totals', async () => {
    const agent = request.agent(server());
    await agent
      .post('/api/auth/login')
      .send({ email: BENCH_EMAIL, password })
      .expect(200);
    const response = await agent.get('/api/dashboard/overview').expect(200);
    expect((response.body as Envelope<unknown>).success).toBe(true);
    const overview = dataOf<Record<string, unknown>>(response);
    expect(overview).toEqual({
      ...fixture.expected.overview,
      savingRate: expect.any(Number) as unknown,
      unreadAlerts: 0,
    });

    // The other dashboard requests agree with the same totals.
    const breakdown = dataOf<Array<{ currency: string; amount: number }>>(
      await agent.get('/api/dashboard/category-breakdown').expect(200),
    );
    for (const group of fixture.expected.currencies) {
      const cents = breakdown
        .filter((row) => row.currency === group.currency)
        .reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
      expect({ currency: group.currency, cents }).toEqual({
        currency: group.currency,
        cents: group.expenseMinor,
      });
    }
    const cashflow = dataOf<
      Array<{ month: string; income: number; expense: number }>
    >(await agent.get('/api/dashboard/cashflow?months=6').expect(200));
    expect(cashflow).toHaveLength(6);
    expect(cashflow[5]).toMatchObject({
      month: fixture.expected.month,
      income: fixture.expected.overview.income,
      expense: fixture.expected.overview.expense,
    });
    const recent = dataOf<Array<{ status: string; isDuplicate: boolean }>>(
      await agent.get('/api/dashboard/recent-transactions').expect(200),
    );
    expect(recent).toHaveLength(5);
    for (const row of recent) {
      expect(row).toMatchObject({ status: 'POSTED', isDuplicate: false });
    }
  });

  it('the runner signs in, matches totals, and completes a short run', async () => {
    await app!.listen(0, '127.0.0.1');
    const { port } = (server() as unknown as Server).address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}/api`;
    const lines: string[] = [];

    const result = await runDashboardBenchmark({
      baseUrl,
      email: BENCH_EMAIL,
      password,
      anchor,
      warmup: 1,
      loads: 5,
      readyTimeoutMs: 10_000,
      log: (line) => lines.push(line),
    });
    expect(result.totalsMismatches).toEqual([]);
    expect(result.totalsMatched).toBe(true);
    expect([...result.warmupFailures, ...result.failures]).toEqual([]);
    expect(result.durationsMs).toHaveLength(5);
    expect(result.stats?.count).toBe(5);
    // Latency is not gated here (T101 owns the gate on the reference host).
    expect([0, 1]).toContain(result.exitCode);
    const output = lines.join('\n');
    expect(output).toContain('RESULT {');
    expect(output).not.toContain(password);

    // A run against another anchor's expectations aborts with exit 3.
    const lastYear = `${Number(anchor.slice(0, 4)) - 1}${anchor.slice(4, 8)}15`;
    const mismatch = await runDashboardBenchmark({
      baseUrl,
      email: BENCH_EMAIL,
      password,
      anchor: lastYear,
      warmup: 0,
      loads: 1,
      readyTimeoutMs: 10_000,
      log: () => undefined,
    });
    expect(mismatch.exitCode).toBe(3);
    expect(mismatch.totalsMismatches.length).toBeGreaterThan(0);
    expect(mismatch.durationsMs).toEqual([]);

    // A wrong password is a failed response (exit 4), before any load.
    const refused = await runDashboardBenchmark({
      baseUrl,
      email: BENCH_EMAIL,
      password: `${password}-wrong`,
      anchor,
      warmup: 0,
      loads: 1,
      readyTimeoutMs: 10_000,
      log: () => undefined,
    });
    expect(refused.exitCode).toBe(4);
    expect(refused.failures).toEqual(['sign-in failed: HTTP 401']);
  });
});
