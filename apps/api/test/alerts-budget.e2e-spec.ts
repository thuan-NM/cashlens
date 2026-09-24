import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import {
  AlertView,
  EmailImportHarness,
  HOUR,
  MutableClock,
  alertsOf,
  alertsWithKey,
  createAlertTestApp,
  createCategory,
  createTransaction,
  setMonthStartDay,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T085 (SC-007, BUDGET-001–BUDGET-005, ALERT-009 budget rows): budget
 * alerts end to end, from real transactions, under a controlled clock.
 * Every scenario owns its budget, so conditions and cooldowns never mix.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');
const SEPT = '2026-09-01'; // the current instance, month-start day 1
const at = (local: string) => `${local}+07:00`;

type BudgetView = {
  id: string;
  thresholdPercent: number;
  warningThresholdActive: boolean;
  criticalThresholdPercent: number;
  alertsSupported: boolean;
  usageBasis: string;
  usage: {
    spent: number;
    percentUsed: number;
    isNearThreshold: boolean;
    periodStart: string | null;
    periodEnd: string | null;
  };
};

describe('Budget alerts (T085)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new MutableClock(NOW);
  const users: TestUser[] = [];
  let alice: TestUser;
  let harness: EmailImportHarness | undefined;

  const newUser = async (label: string) => {
    const user = await registerUser(app, label);
    users.push(user);
    return user;
  };

  const createBudget = async (user: TestUser, body: Record<string, unknown>) =>
    dataOf<BudgetView>(
      await user.agent
        .post('/api/budgets')
        .send({
          name: 'US5 budget',
          amount: 1_000_000,
          currency: 'VND',
          period: 'MONTHLY',
          startsAt: '2026-01-01',
          thresholdPercent: 80,
          ...body,
        })
        .expect(201),
    );

  /** A category and a MONTHLY 1,000,000 VND budget on it, warning at 80%. */
  const scenario = async (user: TestUser, label: string, body = {}) => {
    const categoryId = await createCategory(user.agent, `US5 ${label}`);
    const budget = await createBudget(user, { categoryId, ...body });
    const key = (tier: 'WARNING' | 'CRITICAL', start = SEPT) =>
      `budget:${budget.id}:${start}:${tier}`;
    return { categoryId, budget, key };
  };

  const spend = (
    user: TestUser,
    categoryId: string | undefined,
    amount: number,
    local = '2026-09-10T10:00:00',
  ) =>
    createTransaction(user.agent, {
      amount,
      categoryId,
      transactionTime: at(local),
    });

  const statusOf = async (user: TestUser, key: string) =>
    (await alertsWithKey(user.agent, key)).map((alert) => alert.status);

  beforeAll(async () => {
    app = await createAlertTestApp({ clock });
    prisma = app.get(PrismaService);
    alice = await newUser('us5-budget-alice');
  });

  beforeEach(() => clock.set(NOW));

  afterAll(async () => {
    jest.restoreAllMocks();
    await harness?.cleanup();
    if (prisma) {
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    }
    await app?.close();
  });

  it('opens a WARNING with the ALERT-001 evidence when a create crosses 80%, and no CRITICAL', async () => {
    const { categoryId, budget, key } = await scenario(alice, 'create');
    await spend(alice, categoryId, 850_000);

    const [warning] = await alertsWithKey(alice.agent, key('WARNING'));
    expect(warning).toMatchObject({
      type: 'BUDGET_THRESHOLD',
      severity: 'WARNING',
      status: 'ACTIVE',
      isRead: false,
      resourceType: 'budget',
      resourceId: budget.id,
      thresholdValue: 80,
      observedValue: 85,
      periodStart: '2026-08-31T17:00:00.000Z',
      periodEnd: '2026-09-30T17:00:00.000Z',
      triggeredAt: NOW.toISOString(),
      resolvedAt: null,
      emailDelivery: expect.objectContaining({
        status: 'SKIPPED',
        // This app binds no transport: every delivery is TRANSPORT_DISABLED.
        skipReason: 'TRANSPORT_DISABLED',
      }) as object,
    });
    expect(warning.metadata).toMatchObject({
      budgetId: budget.id,
      currency: 'VND',
      spent: '850000',
      amount: '1000000',
      percentUsed: '85',
    });
    expect(await alertsWithKey(alice.agent, key('CRITICAL'))).toEqual([]);
  });

  it('keeps WARNING and CRITICAL independent: an update to 100% adds CRITICAL, a drop resolves both', async () => {
    const { categoryId, key } = await scenario(alice, 'tiers');
    const id = await spend(alice, categoryId, 850_000);
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ amount: 1_000_000 })
      .expect(200);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['ACTIVE']);
    expect(await statusOf(alice, key('CRITICAL'))).toEqual(['ACTIVE']);

    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ amount: 900_000 })
      .expect(200);
    const [critical] = await alertsWithKey(alice.agent, key('CRITICAL'));
    expect(critical).toMatchObject({
      status: 'RESOLVED',
      resolutionReason: 'BELOW_THRESHOLD',
      resolvedAt: NOW.toISOString(),
    });
    expect(await statusOf(alice, key('WARNING'))).toEqual(['ACTIVE']);

    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ amount: 100_000 })
      .expect(200);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['RESOLVED']);
  });

  it('opens both tiers when one expense jumps past 100%', async () => {
    const { categoryId, key } = await scenario(alice, 'jump');
    await spend(alice, categoryId, 1_500_000);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['ACTIVE']);
    expect(await statusOf(alice, key('CRITICAL'))).toEqual(['ACTIVE']);
  });

  it.each([
    [
      'delete',
      (id: string) => alice.agent.delete(`/api/transactions/${idPath(id)}`),
    ],
    [
      'ignore',
      (id: string) =>
        alice.agent.patch(`/api/transactions/${idPath(id)}/ignore`),
    ],
  ])('resolves on %s', async (label, mutate) => {
    const { categoryId, key } = await scenario(alice, label);
    const id = await spend(alice, categoryId, 900_000);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['ACTIVE']);
    await mutate(id).expect(200);
    expect(await alertsWithKey(alice.agent, key('WARNING'))).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'BELOW_THRESHOLD',
      }),
    ]);
  });

  it('resolves when the expense is marked a duplicate', async () => {
    const { categoryId, key } = await scenario(alice, 'duplicate');
    const original = await spend(alice, undefined, 10_000);
    const id = await spend(alice, categoryId, 900_000);
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}/duplicate`)
      .send({ duplicateOfTransactionId: original })
      .expect(200);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['RESOLVED']);
  });

  it('a category correction resolves the old budget and opens the new one', async () => {
    const from = await scenario(alice, 'recat-from');
    const to = await scenario(alice, 'recat-to');
    const id = await spend(alice, from.categoryId, 900_000);
    expect(await statusOf(alice, from.key('WARNING'))).toEqual(['ACTIVE']);

    await alice.agent
      .patch(`/api/transactions/${idPath(id)}/category`)
      .send({ categoryId: to.categoryId })
      .expect(200);

    expect(await statusOf(alice, from.key('WARNING'))).toEqual(['RESOLVED']);
    expect(await statusOf(alice, to.key('WARNING'))).toEqual(['ACTIVE']);
  });

  it('moving an expense to a past month resolves the current instance and opens nothing for the past one', async () => {
    const { categoryId, key } = await scenario(alice, 'move');
    const id = await spend(alice, categoryId, 900_000);
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ transactionTime: at('2026-08-10T10:00:00') })
      .expect(200);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['RESOLVED']);
    expect(
      await alertsWithKey(alice.agent, key('WARNING', '2026-08-01')),
    ).toEqual([]);
  });

  it('never opens an occurrence for a past period', async () => {
    const { categoryId, budget } = await scenario(alice, 'past');
    await spend(alice, categoryId, 2_000_000, '2026-08-15T10:00:00');
    expect(
      (await alertsOf(alice.agent)).filter(
        (alert) => alert.resourceId === budget.id,
      ),
    ).toEqual([]);
  });

  it('resolves the open conditions with PERIOD_ENDED at the first trigger after the month rolls over', async () => {
    const { categoryId, key } = await scenario(alice, 'rollover');
    await spend(alice, categoryId, 1_200_000);
    clock.set('2026-10-02T09:00:00+07:00');
    await spend(alice, undefined, 1_000); // any trigger
    for (const tier of ['WARNING', 'CRITICAL'] as const) {
      expect(await alertsWithKey(alice.agent, key(tier))).toEqual([
        expect.objectContaining({
          status: 'RESOLVED',
          resolutionReason: 'PERIOD_ENDED',
        }),
      ]);
    }
  });

  it('re-opens a crossing only at the first evaluation 24h after the last trigger; a suppressed crossing is not stored', async () => {
    const { categoryId, budget, key } = await scenario(alice, 'cooldown');
    const recalculate = () =>
      alice.agent
        .post(`/api/budgets/${idPath(budget.id)}/recalculate`)
        .expect(200);
    const id = await spend(alice, categoryId, 900_000);
    const drop = () =>
      alice.agent
        .patch(`/api/transactions/${idPath(id)}`)
        .send({ amount: 100_000 })
        .expect(200);
    const cross = () =>
      alice.agent
        .patch(`/api/transactions/${idPath(id)}`)
        .send({ amount: 900_000 })
        .expect(200);

    clock.advance(HOUR);
    await drop();
    clock.advance(HOUR);
    await cross(); // 2h after the trigger: suppressed
    expect(await statusOf(alice, key('WARNING'))).toEqual(['RESOLVED']);

    clock.set(new Date(NOW.getTime() + 24 * HOUR - 1));
    await recalculate();
    expect(await statusOf(alice, key('WARNING'))).toEqual(['RESOLVED']);

    clock.set(new Date(NOW.getTime() + 24 * HOUR));
    await recalculate();
    const rows = await alertsWithKey(alice.agent, key('WARNING'));
    expect(rows.map((alert) => alert.status)).toEqual(['RESOLVED', 'ACTIVE']);
    expect(rows[1].triggeredAt).toBe(
      new Date(NOW.getTime() + 24 * HOUR).toISOString(),
    );
  });

  it('POST /budgets/:id/recalculate evaluates spend the triggers did not see, and returns usage and changes', async () => {
    const { categoryId, budget, key } = await scenario(alice, 'recalc');
    // Written behind the API's back: no trigger ran.
    await prisma.transaction.create({
      data: {
        userId: alice.id,
        categoryId,
        amount: new Prisma.Decimal(950_000),
        currency: 'VND',
        direction: 'EXPENSE',
        transactionTime: new Date(at('2026-09-12T10:00:00')),
      },
    });
    expect(await alertsWithKey(alice.agent, key('WARNING'))).toEqual([]);

    const result = dataOf<{
      budget: BudgetView;
      alertChanges: { evaluated: boolean; created: number; resolved: number };
    }>(
      await alice.agent
        .post(`/api/budgets/${idPath(budget.id)}/recalculate`)
        .expect(200),
    );
    expect(result.alertChanges).toEqual({
      evaluated: true,
      created: 1,
      resolved: 0,
    });
    expect(result.budget.usage).toMatchObject({
      spent: 950_000,
      percentUsed: 95,
      isNearThreshold: true,
    });
    expect(await statusOf(alice, key('WARNING'))).toEqual(['ACTIVE']);
  });

  it('a threshold change re-evaluates the current period', async () => {
    const { categoryId, budget, key } = await scenario(alice, 'retune');
    await spend(alice, categoryId, 850_000);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['ACTIVE']);
    await alice.agent
      .patch(`/api/budgets/${idPath(budget.id)}`)
      .send({ thresholdPercent: 90 })
      .expect(200);
    expect(await statusOf(alice, key('WARNING'))).toEqual(['RESOLVED']);
  });

  it('archiving a budget resolves its open alerts with TARGET_REMOVED', async () => {
    const { categoryId, budget, key } = await scenario(alice, 'archive');
    await spend(alice, categoryId, 1_000_000);
    await alice.agent.delete(`/api/budgets/${idPath(budget.id)}`).expect(200);
    for (const tier of ['WARNING', 'CRITICAL'] as const) {
      expect(await alertsWithKey(alice.agent, key(tier))).toEqual([
        expect.objectContaining({
          status: 'RESOLVED',
          resolutionReason: 'TARGET_REMOVED',
        }),
      ]);
    }
  });

  it('rejects a threshold of 100 or more on write (400), and accepts 99', async () => {
    const categoryId = await createCategory(alice.agent, 'US5 threshold');
    await alice.agent
      .post('/api/budgets')
      .send({
        name: 'US5 bad',
        amount: 1000,
        startsAt: '2026-01-01',
        categoryId,
        thresholdPercent: 100,
      })
      .expect(400);
    const budget = await createBudget(alice, {
      categoryId,
      thresholdPercent: 99,
    });
    expect(budget).toMatchObject({
      thresholdPercent: 99,
      warningThresholdActive: true,
      criticalThresholdPercent: 100,
    });
    await alice.agent
      .patch(`/api/budgets/${idPath(budget.id)}`)
      .send({ thresholdPercent: 150 })
      .expect(400);
  });

  it('a legacy threshold of 150 keeps its value, has no warning, and still alerts at 100%', async () => {
    const { categoryId, budget, key } = await scenario(alice, 'legacy');
    await prisma.budget.update({
      where: { id: budget.id },
      data: { thresholdPercent: 150 },
    });
    await spend(alice, categoryId, 990_000);
    const view = dataOf<BudgetView>(
      await alice.agent.get(`/api/budgets/${idPath(budget.id)}`).expect(200),
    );
    expect(view).toMatchObject({
      thresholdPercent: 150,
      warningThresholdActive: false,
      usage: { isNearThreshold: false },
    });
    expect(await alertsWithKey(alice.agent, key('WARNING'))).toEqual([]);
    expect(await alertsWithKey(alice.agent, key('CRITICAL'))).toEqual([]);

    await spend(alice, categoryId, 10_000);
    expect(await alertsWithKey(alice.agent, key('WARNING'))).toEqual([]);
    expect(await statusOf(alice, key('CRITICAL'))).toEqual(['ACTIVE']);
  });

  it('a WEEKLY budget stays fully usable, reports alertsSupported false, and never alerts', async () => {
    const categoryId = await createCategory(alice.agent, 'US5 weekly');
    const weekly = await createBudget(alice, {
      categoryId,
      period: 'WEEKLY',
      amount: 1000,
    });
    expect(weekly).toMatchObject({
      alertsSupported: false,
      usageBasis: 'CALENDAR_MONTH_APPROXIMATION',
    });
    await spend(alice, categoryId, 50_000);
    await alice.agent
      .patch(`/api/budgets/${idPath(weekly.id)}`)
      .send({ amount: 2000 })
      .expect(200);
    await alice.agent
      .post(`/api/budgets/${idPath(weekly.id)}/recalculate`)
      .expect(200);
    expect(
      (await alertsOf(alice.agent)).filter(
        (alert) => alert.resourceId === weekly.id,
      ),
    ).toEqual([]);
    const listed = dataOf<BudgetView[]>(
      await alice.agent.get('/api/budgets').expect(200),
    ).find((budget) => budget.id === weekly.id);
    expect(listed).toMatchObject({ alertsSupported: false });
    await alice.agent.delete(`/api/budgets/${idPath(weekly.id)}`).expect(200);
  });

  it('email disabled for the deployment: settings say unavailable and a CRITICAL is SKIPPED/TRANSPORT_DISABLED (CFG-007)', async () => {
    const quiet = await newUser('us5-budget-transport');
    const settings = dataOf<{ type: string; emailAvailable: boolean }[]>(
      await quiet.agent.get('/api/alerts/settings').expect(200),
    );
    expect(settings.every((setting) => !setting.emailAvailable)).toBe(true);
    await quiet.agent
      .patch('/api/alerts/settings')
      .send({ type: 'BUDGET_THRESHOLD', emailEnabled: true })
      .expect(200);
    const { categoryId, key } = await scenario(quiet, 'transport');
    await spend(quiet, categoryId, 1_000_000);
    const [critical] = await alertsWithKey(quiet.agent, key('CRITICAL'));
    expect(critical.emailDelivery).toEqual({
      channel: 'EMAIL',
      status: 'SKIPPED',
      skipReason: 'TRANSPORT_DISABLED',
      attemptCount: 0,
      lastAttemptAt: null,
      sentAt: null,
      failureCode: null,
    });
  });

  it('the budget summary totals only base-currency budgets (review finding: never add currencies)', async () => {
    const sam = await newUser('us5-budget-summary');
    await createBudget(sam, { amount: 1_000_000, currency: 'VND' });
    await createBudget(sam, { amount: 500, currency: 'USD' });
    const summary = dataOf<{
      currency: string;
      totalLimit: number;
      totalSpent: number;
    }>(await sam.agent.get('/api/budgets/summary?month=2026-09').expect(200));
    expect(summary).toMatchObject({ currency: 'VND', totalLimit: 1_000_000 });
  });

  it('counts only the budget currency', async () => {
    const { categoryId, key } = await scenario(alice, 'currency');
    await createTransaction(alice.agent, {
      amount: 5_000_000,
      categoryId,
      currency: 'USD',
      transactionTime: at('2026-09-10T10:00:00'),
    });
    expect(await alertsWithKey(alice.agent, key('WARNING'))).toEqual([]);
  });

  it('reads never write alerts: budget list, summary, projection, and dashboard hot budgets', async () => {
    const reader = await newUser('us5-budget-reader');
    const categoryId = await createCategory(reader.agent, 'US5 reader');
    const budget = await prisma.budget.create({
      data: {
        userId: reader.id,
        categoryId,
        name: 'US5 read-only',
        amount: new Prisma.Decimal(1_000_000),
        startsAt: new Date('2026-01-01'),
      },
    });
    await prisma.transaction.create({
      data: {
        userId: reader.id,
        categoryId,
        amount: new Prisma.Decimal(1_200_000),
        direction: 'EXPENSE',
        transactionTime: new Date(at('2026-09-12T10:00:00')),
      },
    });
    const projected = dataOf<{ id: string }[]>(
      await reader.agent.get('/api/budgets/alerts').expect(200),
    );
    expect(projected.map((item) => item.id)).toEqual([budget.id]);
    await reader.agent.get('/api/budgets').expect(200);
    await reader.agent.get('/api/budgets/summary').expect(200);
    await reader.agent.get(`/api/budgets/${idPath(budget.id)}`).expect(200);
    const hot = dataOf<{ id: string }[]>(
      await reader.agent
        .get('/api/dashboard/hot-budgets?month=2026-09')
        .expect(200),
    );
    expect(hot.map((item) => item.id)).toEqual([budget.id]);
    expect(await prisma.alert.count({ where: { userId: reader.id } })).toBe(0);
  });

  it('uses the user-month instance for month-start day 25 (2026-09-23 is in the instance starting 2026-08-25)', async () => {
    const bob = await newUser('us5-budget-day25');
    await setMonthStartDay(bob.agent, 25);
    const { categoryId, budget } = await scenario(bob, 'day25');
    // 2026-08-30 is inside the 2026-08-25 instance, not the calendar month.
    await spend(bob, categoryId, 900_000, '2026-08-30T10:00:00');
    const [warning] = await alertsWithKey(
      bob.agent,
      `budget:${budget.id}:2026-08-25:WARNING`,
    );
    expect(warning).toMatchObject({
      status: 'ACTIVE',
      periodStart: '2026-08-24T17:00:00.000Z',
      periodEnd: '2026-09-24T17:00:00.000Z',
    });
    const view = dataOf<BudgetView>(
      await bob.agent.get(`/api/budgets/${idPath(budget.id)}`).expect(200),
    );
    expect(view).toMatchObject({
      usageBasis: 'PERIOD_INSTANCE',
      usage: {
        spent: 900_000,
        periodStart: '2026-08-24T17:00:00.000Z',
        periodEnd: '2026-09-24T17:00:00.000Z',
      },
    });
  });

  it('an imported expense creates the same alert as the equivalent manual expense', async () => {
    const importer = await newUser('us5-budget-import');
    const manual = await newUser('us5-budget-manual');
    const created = await EmailImportHarness.create(app, importer, 'us5b');
    harness = created.harness;
    users.push(created.admin);

    const importedBudget = await createBudget(importer, {}); // all categories
    const manualBudget = await createBudget(manual, {});

    harness.queue({ amount: 850_000, time: '10/09/2026 10:00:00' });
    expect(await harness.sync()).toMatchObject({
      status: 'SUCCESS',
      transactionsCreated: 1,
    });
    await spend(manual, undefined, 850_000);

    const [imported] = await alertsWithKey(
      importer.agent,
      `budget:${importedBudget.id}:${SEPT}:WARNING`,
    );
    const [typed] = await alertsWithKey(
      manual.agent,
      `budget:${manualBudget.id}:${SEPT}:WARNING`,
    );
    // Everything but identity and the per-user text must match.
    const comparable = (alert: AlertView) => ({
      type: alert.type,
      severity: alert.severity,
      status: alert.status,
      isRead: alert.isRead,
      resourceType: alert.resourceType,
      thresholdValue: alert.thresholdValue,
      observedValue: alert.observedValue,
      periodStart: alert.periodStart,
      periodEnd: alert.periodEnd,
      triggeredAt: alert.triggeredAt,
      resolvedAt: alert.resolvedAt,
      emailDelivery: alert.emailDelivery,
    });
    expect(imported).toBeDefined();
    expect(comparable(imported)).toEqual(comparable(typed));

    // A replay of the same mailbox creates nothing and changes nothing.
    await harness.sync();
    expect(
      await alertsWithKey(
        importer.agent,
        `budget:${importedBudget.id}:${SEPT}:WARNING`,
      ),
    ).toHaveLength(1);
  });
});
