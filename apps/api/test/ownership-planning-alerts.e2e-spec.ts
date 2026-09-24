import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Agent,
  MALFORMED_IDS,
  RUN_ID,
  TestUser,
  absentId,
  cleanupUsers,
  dataOf,
  idPath,
  promoteToAdminForTest,
  registerUser,
} from './helpers/auth-fixtures';

/**
 * T015 [SEC-001, SEC-005, SEC-008, TEST-003]: ownership matrix for planning
 * and alerts (budgets, goals with contributions and simulation, alerts, alert
 * settings).
 *
 * Alice owns every target row. Bob (USER) and an ADMIN must get the same
 * owner-safe 404 as for an absent id on every read, update, delete or action,
 * must see only their own rows in lists, and must never change Alice's rows.
 * Administrator status grants no access to private planning data (SEC-008).
 */

jest.setTimeout(30_000);

type Method = 'get' | 'post' | 'patch' | 'delete';
type Caller = Pick<Agent, Method>;
type Kind = 'budget' | 'goal' | 'alert' | 'alertSetting';

type IdView = { id: string };
type BudgetView = IdView & { amount: number };
type BudgetSummaryView = {
  totalLimit: number;
  totalSpent: number;
  nearThresholdCount: number;
};
type AlertPageView = { data: IdView[]; total: number };
type AlertSettingView = IdView & { type: string; threshold: number | null };

type OwnRows = { budgetId: string; goalId: string; alertId: string };
type AliceRows = OwnRows & {
  categoryId: string;
  warningAlertId: string;
  settingIds: string[];
};

type Actor = {
  role: 'USER' | 'ADMIN';
  user: () => TestUser;
  own: () => OwnRows;
};

type Probe = {
  route: string;
  method: Method;
  path: (id: string) => string;
  body?: Record<string, unknown>;
  target: () => string;
};

// Budgets start in a fixed past month and never end, so they are active in
// the current month regardless of when the suite runs.
const MONTH = new Date().toISOString().slice(0, 7);
const BUDGET_START = '2026-01-01T00:00:00.000Z';
const ALICE_MARK = `alice-${RUN_ID}`;
const ALICE_BUDGET_AMOUNT = 100_000;
const ALICE_SPEND = 90_000; // 90% of the budget: above the 80% threshold
const ALICE_THRESHOLD = 7_654_321;
const OWN_BUDGET_AMOUNT = 1_000_000;
const OWN_THRESHOLD = 1;

const uniqueName = (label: string) =>
  `E2E ${label} ${RUN_ID} ${randomBytes(3).toString('hex')}`;

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Error body without per-request fields, to compare two 404 responses. */
function stableBody(response: request.Response): Record<string, unknown> {
  const volatile = new Set([
    'timestamp',
    'path',
    'requestId',
    'traceId',
    'correlationId',
  ]);
  const body = (response.body ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !volatile.has(key)),
  );
}

function call(
  caller: Caller,
  method: Method,
  path: string,
  body?: Record<string, unknown>,
) {
  const pending = caller[method](path);
  return body ? pending.send(body) : pending;
}

/**
 * Alice's two user-authored alerts stay unread, and so does every alert the
 * evaluators opened for her since US5 (her 90% budget opens a WARNING while
 * its month is current): no caller's read ever reaches them. The number of
 * evaluator alerts depends on the real month, so it is not asserted.
 */
const expectAliceAlertsUnread = (
  alerts: { isRead: boolean; conditionKey: string | null }[],
) => {
  expect(
    alerts.filter((alert) => alert.conditionKey === null && !alert.isRead),
  ).toHaveLength(2);
  expect(alerts.every((alert) => !alert.isRead)).toBe(true);
};

describe('Ownership matrix: planning and alerts (T015)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  let aliceRows: AliceRows;
  const own: Record<'bob' | 'admin', OwnRows> = {
    bob: { budgetId: '', goalId: '', alertId: '' },
    admin: { budgetId: '', goalId: '', alertId: '' },
  };

  const anonymous = (): Caller => request(app.getHttpServer());

  /** Every planning and alert row Alice owns, read straight from the database. */
  async function aliceState() {
    const where = { userId: alice.id };
    const orderBy = { id: 'asc' as const };
    const [budgets, goals, alerts, alertSettings, categories, transactions] =
      await Promise.all([
        prisma.budget.findMany({ where, orderBy }),
        prisma.goal.findMany({ where, orderBy }),
        prisma.alert.findMany({ where, orderBy }),
        prisma.alertSetting.findMany({ where, orderBy }),
        prisma.transactionCategory.findMany({ where, orderBy }),
        prisma.transaction.findMany({ where, orderBy }),
      ]);
    return { budgets, goals, alerts, alertSettings, categories, transactions };
  }

  async function ownerIdsOf(kind: Kind, ids: string[]): Promise<string[]> {
    const args = { where: { id: { in: ids } }, select: { userId: true } };
    let rows: { userId: string }[];
    if (kind === 'budget') {
      rows = await prisma.budget.findMany(args);
    } else if (kind === 'goal') {
      rows = await prisma.goal.findMany(args);
    } else if (kind === 'alert') {
      rows = await prisma.alert.findMany(args);
    } else {
      rows = await prisma.alertSetting.findMany(args);
    }
    return rows.map((row) => row.userId);
  }

  /** Every listed id exists and belongs to the caller. */
  async function expectOwnedBy(kind: Kind, ids: string[], owner: TestUser) {
    expect(await ownerIdsOf(kind, ids)).toEqual(ids.map(() => owner.id));
  }

  async function createOwnRows(user: TestUser, label: string) {
    const budget = await user.agent
      .post('/api/budgets')
      .send({
        name: `E2E ${label} budget ${RUN_ID}`,
        amount: OWN_BUDGET_AMOUNT,
        startsAt: BUDGET_START,
      })
      .expect(201);
    const goal = await user.agent
      .post('/api/goals')
      .send({
        name: `E2E ${label} goal ${RUN_ID}`,
        targetAmount: 2_000_000,
        months: 4,
      })
      .expect(201);
    const alert = await user.agent
      .post('/api/alerts')
      .send({
        type: 'SYSTEM',
        severity: 'CRITICAL',
        title: `E2E ${label} alert ${RUN_ID}`,
        message: 'Synthetic ownership fixture',
      })
      .expect(201);
    return {
      budgetId: dataOf<IdView>(budget).id,
      goalId: dataOf<IdView>(goal).id,
      alertId: dataOf<IdView>(alert).id,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 'own-plan-alice');
    bob = await registerUser(app, 'own-plan-bob');
    admin = await registerUser(app, 'own-plan-admin');
    await promoteToAdminForTest(prisma, admin.id);
    // Sign in again so the session carries the persisted ADMIN role.
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);

    // Alice's private rows, created through the public API.
    const category = await alice.agent
      .post('/api/transaction-categories')
      .send({ name: `E2E ${ALICE_MARK} category` })
      .expect(201);
    const categoryId = dataOf<IdView>(category).id;
    await alice.agent
      .post('/api/transactions')
      .send({
        amount: ALICE_SPEND,
        direction: 'EXPENSE',
        transactionTime: `${MONTH}-01T12:00:00.000Z`,
        categoryId,
        description: `E2E ${ALICE_MARK} spend`,
      })
      .expect(201);
    const budget = await alice.agent
      .post('/api/budgets')
      .send({
        name: `E2E ${ALICE_MARK} budget`,
        amount: ALICE_BUDGET_AMOUNT,
        startsAt: BUDGET_START,
        categoryId,
        thresholdPercent: 80,
      })
      .expect(201);
    const goal = await alice.agent
      .post('/api/goals')
      .send({
        name: `E2E ${ALICE_MARK} goal`,
        targetAmount: 5_000_000,
        savedAmount: 1_000_000,
        months: 6,
      })
      .expect(201);
    const critical = await alice.agent
      .post('/api/alerts')
      .send({
        type: 'SYSTEM',
        severity: 'CRITICAL',
        title: `E2E ${ALICE_MARK} critical alert`,
        message: `Synthetic ${ALICE_MARK} alert`,
      })
      .expect(201);
    const warning = await alice.agent
      .post('/api/alerts')
      .send({
        type: 'BUDGET_THRESHOLD',
        severity: 'WARNING',
        title: `E2E ${ALICE_MARK} warning alert`,
        message: `Synthetic ${ALICE_MARK} alert`,
      })
      .expect(201);
    await alice.agent.get('/api/alerts/settings').expect(200);
    await alice.agent
      .patch('/api/alerts/settings')
      .send({
        type: 'LARGE_TRANSACTION',
        inAppEnabled: true,
        emailEnabled: false,
        threshold: ALICE_THRESHOLD,
      })
      .expect(200);
    const settings = await prisma.alertSetting.findMany({
      where: { userId: alice.id },
      select: { id: true },
    });

    aliceRows = {
      categoryId,
      budgetId: dataOf<IdView>(budget).id,
      goalId: dataOf<IdView>(goal).id,
      alertId: dataOf<IdView>(critical).id,
      warningAlertId: dataOf<IdView>(warning).id,
      settingIds: settings.map((setting) => setting.id),
    };
    own.bob = await createOwnRows(bob, 'own-plan-bob');
    own.admin = await createOwnRows(admin, 'own-plan-admin');
  }, 120_000);

  afterAll(async () => {
    // Owned budgets, goals, alerts, settings, categories and transactions cascade.
    if (prisma) {
      await cleanupUsers(prisma, [alice?.id, bob?.id, admin?.id]);
    }
    await app?.close();
  }, 60_000);

  const actors: Actor[] = [
    { role: 'USER', user: () => bob, own: () => own.bob },
    { role: 'ADMIN', user: () => admin, own: () => own.admin },
  ];

  const probes: Probe[] = [
    {
      route: 'GET /budgets/:id',
      method: 'get',
      path: (id) => `/api/budgets/${idPath(id)}`,
      target: () => aliceRows.budgetId,
    },
    {
      route: 'PATCH /budgets/:id',
      method: 'patch',
      path: (id) => `/api/budgets/${idPath(id)}`,
      body: { name: 'E2E hijacked budget', amount: 1, thresholdPercent: 10 },
      target: () => aliceRows.budgetId,
    },
    {
      route: 'DELETE /budgets/:id',
      method: 'delete',
      path: (id) => `/api/budgets/${idPath(id)}`,
      target: () => aliceRows.budgetId,
    },
    {
      route: 'GET /goals/:id',
      method: 'get',
      path: (id) => `/api/goals/${idPath(id)}`,
      target: () => aliceRows.goalId,
    },
    {
      route: 'GET /goals/:id/simulation',
      method: 'get',
      path: (id) => `/api/goals/${idPath(id)}/simulation`,
      target: () => aliceRows.goalId,
    },
    {
      route: 'PATCH /goals/:id',
      method: 'patch',
      path: (id) => `/api/goals/${idPath(id)}`,
      body: { name: 'E2E hijacked goal', savedAmount: 1, priority: 'LOW' },
      target: () => aliceRows.goalId,
    },
    {
      route: 'POST /goals/:id/contribution',
      method: 'post',
      path: (id) => `/api/goals/${idPath(id)}/contribution`,
      body: { amount: 250_000 },
      target: () => aliceRows.goalId,
    },
    {
      route: 'DELETE /goals/:id',
      method: 'delete',
      path: (id) => `/api/goals/${idPath(id)}`,
      target: () => aliceRows.goalId,
    },
    {
      route: 'PATCH /alerts/:id/read',
      method: 'patch',
      path: (id) => `/api/alerts/${idPath(id)}/read`,
      target: () => aliceRows.alertId,
    },
  ];

  describe('fixtures: alice (owner) can reach her own rows', () => {
    it('the ADMIN actor is a persisted, signed-in administrator', async () => {
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: admin.id },
      });
      expect(stored.role).toBe('ADMIN');
      const me = await admin.agent.get('/api/auth/me').expect(200);
      expect(dataOf<{ role: string }>(me).role).toBe('ADMIN');
    });

    it('alice reads her budget, goal and goal simulation', async () => {
      await alice.agent
        .get(`/api/budgets/${idPath(aliceRows.budgetId)}`)
        .expect(200);
      await alice.agent
        .get(`/api/goals/${idPath(aliceRows.goalId)}`)
        .expect(200);
      await alice.agent
        .get(`/api/goals/${idPath(aliceRows.goalId)}/simulation`)
        .expect(200);
    });

    it('alice sees her budget in GET /budgets and in the near-threshold projection', async () => {
      const list = dataOf<BudgetView[]>(
        await alice.agent.get(`/api/budgets?month=${MONTH}`).expect(200),
      );
      expect(list.map((budget) => budget.id)).toContain(aliceRows.budgetId);
      const projection = dataOf<BudgetView[]>(
        await alice.agent.get(`/api/budgets/alerts?month=${MONTH}`).expect(200),
      );
      expect(projection.map((budget) => budget.id)).toContain(
        aliceRows.budgetId,
      );
      const summary = dataOf<BudgetSummaryView>(
        await alice.agent
          .get(`/api/budgets/summary?month=${MONTH}`)
          .expect(200),
      );
      expect(summary.totalSpent).toBe(ALICE_SPEND);
    });

    it('alice lists her goal, her alerts and her customized alert setting', async () => {
      const goals = dataOf<IdView[]>(
        await alice.agent.get('/api/goals').expect(200),
      );
      expect(goals.map((goal) => goal.id)).toContain(aliceRows.goalId);
      const alerts = dataOf<AlertPageView>(
        await alice.agent.get('/api/alerts?limit=100').expect(200),
      );
      expect(alerts.data.map((alert) => alert.id)).toEqual(
        expect.arrayContaining([aliceRows.alertId, aliceRows.warningAlertId]),
      );
      const settings = dataOf<AlertSettingView[]>(
        await alice.agent.get('/api/alerts/settings').expect(200),
      );
      expect(
        settings.find((setting) => setting.type === 'LARGE_TRANSACTION')
          ?.threshold,
      ).toBe(ALICE_THRESHOLD);
      expect(aliceRows.settingIds.length).toBeGreaterThan(0);
    });
  });

  describe('unauthenticated requests', () => {
    const routes: Array<{
      route: string;
      method: Method;
      path: () => string;
      body?: Record<string, unknown>;
    }> = [
      { route: 'GET /budgets', method: 'get', path: () => '/api/budgets' },
      {
        route: 'GET /budgets/summary',
        method: 'get',
        path: () => '/api/budgets/summary',
      },
      {
        route: 'GET /budgets/alerts',
        method: 'get',
        path: () => '/api/budgets/alerts',
      },
      {
        route: 'POST /budgets',
        method: 'post',
        path: () => '/api/budgets',
        body: { name: 'E2E anonymous', amount: 1, startsAt: BUDGET_START },
      },
      ...probes
        .filter((probe) => probe.route.includes('/budgets/'))
        .map((probe) => ({ ...probe, path: () => probe.path(probe.target()) })),
      { route: 'GET /goals', method: 'get', path: () => '/api/goals' },
      {
        route: 'POST /goals',
        method: 'post',
        path: () => '/api/goals',
        body: { name: 'E2E anonymous', targetAmount: 1 },
      },
      ...probes
        .filter((probe) => probe.route.includes('/goals/'))
        .map((probe) => ({ ...probe, path: () => probe.path(probe.target()) })),
      { route: 'GET /alerts', method: 'get', path: () => '/api/alerts' },
      {
        route: 'POST /alerts',
        method: 'post',
        path: () => '/api/alerts',
        body: { type: 'SYSTEM', title: 'E2E anonymous', message: 'x' },
      },
      {
        route: 'PATCH /alerts/read-all',
        method: 'patch',
        path: () => '/api/alerts/read-all',
      },
      {
        route: 'GET /alerts/settings',
        method: 'get',
        path: () => '/api/alerts/settings',
      },
      {
        route: 'PATCH /alerts/settings',
        method: 'patch',
        path: () => '/api/alerts/settings',
        body: { type: 'LARGE_TRANSACTION', threshold: OWN_THRESHOLD },
      },
      ...probes
        .filter((probe) => probe.route.includes('/alerts/'))
        .map((probe) => ({ ...probe, path: () => probe.path(probe.target()) })),
    ];

    it.each(routes.map((route) => [route.route, route]))(
      "no session gets 401 on %s and alice's rows are unchanged",
      async (_name, route) => {
        const before = await aliceState();
        const response = await call(
          anonymous(),
          route.method,
          route.path(),
          route.body,
        );
        expect(response.status).toBe(401);
        expect(await aliceState()).toEqual(before);
      },
    );

    it("a forged token claiming alice's identity gets 401 (bearer and cookie)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const forged = [
        base64url({ alg: 'HS256', typ: 'JWT' }),
        base64url({ sub: alice.id, role: 'ADMIN', iat: now, exp: now + 600 }),
        randomBytes(32).toString('base64url'),
      ].join('.');
      const path = `/api/budgets/${idPath(aliceRows.budgetId)}`;
      await anonymous()
        .get(path)
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
      await anonymous()
        .get(path)
        .set('Cookie', `accessToken=${forged}`)
        .expect(401);
      await anonymous()
        .get('/api/alerts')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  describe.each(actors)("$role caller against alice's rows", (actor) => {
    const { role } = actor;

    describe('owner-safe 404 on every read, update, delete and action', () => {
      it.each(probes.map((probe) => [probe.route, probe]))(
        `${role} gets 404 on %s for alice's row, identical to an absent id, and nothing changes`,
        async (_name, probe) => {
          const caller = actor.user().agent;
          const before = await aliceState();
          const foreign = await call(
            caller,
            probe.method,
            probe.path(probe.target()),
            probe.body,
          );
          const absent = await call(
            caller,
            probe.method,
            probe.path(absentId()),
            probe.body,
          );
          expect(foreign.status).toBe(404);
          expect(absent.status).toBe(404);
          expect(stableBody(foreign)).toEqual(stableBody(absent));
          const disclosed = JSON.stringify(foreign.body ?? {});
          expect(disclosed).not.toContain(ALICE_MARK);
          expect(disclosed).not.toContain(alice.email);
          expect(await aliceState()).toEqual(before);
        },
      );

      it.each(probes.map((probe) => [probe.route, probe]))(
        `${role} gets 404 (never 500) on %s for every malformed id`,
        async (_name, probe) => {
          const caller = actor.user().agent;
          const statuses: string[] = [];
          for (const [index, malformed] of MALFORMED_IDS.entries()) {
            const response = await call(
              caller,
              probe.method,
              probe.path(malformed),
              probe.body,
            );
            statuses.push(`#${index}: ${response.status}`);
          }
          expect(statuses).toEqual(
            MALFORMED_IDS.map((_malformed, index) => `#${index}: 404`),
          );
        },
      );
    });

    describe("budgets: lists and aggregates contain only the caller's rows", () => {
      it(`${role} GET /budgets lists only the caller's budgets`, async () => {
        const user = actor.user();
        for (const query of [
          `?month=${MONTH}`,
          `?month=${MONTH}&period=MONTHLY`,
        ]) {
          const list = dataOf<BudgetView[]>(
            await user.agent.get(`/api/budgets${query}`).expect(200),
          );
          const ids = list.map((budget) => budget.id);
          expect(ids).toContain(actor.own().budgetId);
          expect(ids).not.toContain(aliceRows.budgetId);
          await expectOwnedBy('budget', ids, user);
        }
      });

      it(`${role} GET /budgets/summary aggregates only the caller's budgets and spending`, async () => {
        const user = actor.user();
        const list = dataOf<BudgetView[]>(
          await user.agent.get(`/api/budgets?month=${MONTH}`).expect(200),
        );
        const summary = dataOf<BudgetSummaryView>(
          await user.agent
            .get(`/api/budgets/summary?month=${MONTH}`)
            .expect(200),
        );
        expect(summary.totalLimit).toBe(
          list.reduce((sum, budget) => sum + budget.amount, 0),
        );
        // Only Alice has spending; none of it may reach another caller.
        expect(summary.totalSpent).toBe(0);
        expect(summary.nearThresholdCount).toBe(0);
      });

      it(`${role} GET /budgets/alerts never projects alice's near-threshold budget`, async () => {
        const user = actor.user();
        const projection = dataOf<BudgetView[]>(
          await user.agent
            .get(`/api/budgets/alerts?month=${MONTH}`)
            .expect(200),
        );
        const ids = projection.map((budget) => budget.id);
        expect(ids).not.toContain(aliceRows.budgetId);
        await expectOwnedBy('budget', ids, user);
      });
    });

    describe('budgets: related ids owned by alice never link', () => {
      it(`${role} cannot create a budget that references alice's category (400 or 404, same as an absent category)`, async () => {
        const user = actor.user();
        const name = uniqueName('foreign-category budget');
        const payload = { name, amount: 1_000, startsAt: BUDGET_START };
        const foreign = await user.agent
          .post('/api/budgets')
          .send({ ...payload, categoryId: aliceRows.categoryId });
        const absent = await user.agent
          .post('/api/budgets')
          .send({ ...payload, categoryId: absentId() });
        expect([400, 404]).toContain(foreign.status);
        expect(stableBody(foreign)).toEqual(stableBody(absent));
        expect(await prisma.budget.count({ where: { name } })).toBe(0);
        expect(
          await prisma.budget.count({
            where: {
              categoryId: aliceRows.categoryId,
              userId: { not: alice.id },
            },
          }),
        ).toBe(0);
      });

      it(`${role} cannot move their own budget onto alice's category`, async () => {
        const user = actor.user();
        const budgetId = actor.own().budgetId;
        const before = await prisma.budget.findUniqueOrThrow({
          where: { id: budgetId },
        });
        const response = await user.agent
          .patch(`/api/budgets/${idPath(budgetId)}`)
          .send({ categoryId: aliceRows.categoryId });
        expect([400, 404]).toContain(response.status);
        expect(
          await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } }),
        ).toEqual(before);
      });
    });

    describe("goals: lists contain only the caller's rows", () => {
      it.each(['', '?status=ACTIVE'])(
        `${role} GET /goals%s lists only the caller's goals`,
        async (query) => {
          const user = actor.user();
          const list = dataOf<IdView[]>(
            await user.agent.get(`/api/goals${query}`).expect(200),
          );
          const ids = list.map((goal) => goal.id);
          expect(ids).toContain(actor.own().goalId);
          expect(ids).not.toContain(aliceRows.goalId);
          await expectOwnedBy('goal', ids, user);
        },
      );
    });

    describe("alerts: list, create and bulk read touch only the caller's rows", () => {
      it(`${role} GET /alerts lists only the caller's alerts`, async () => {
        const user = actor.user();
        const page = dataOf<AlertPageView>(
          await user.agent.get('/api/alerts?limit=100').expect(200),
        );
        const ids = page.data.map((alert) => alert.id);
        expect(ids).toContain(actor.own().alertId);
        expect(ids).not.toContain(aliceRows.alertId);
        expect(ids).not.toContain(aliceRows.warningAlertId);
        await expectOwnedBy('alert', ids, user);
        expect(page.total).toBe(
          await prisma.alert.count({ where: { userId: user.id } }),
        );
      });

      it(`${role} GET /alerts?severity=CRITICAL lists only the caller's critical alerts`, async () => {
        const user = actor.user();
        const page = dataOf<AlertPageView>(
          await user.agent
            .get('/api/alerts?severity=CRITICAL&limit=100')
            .expect(200),
        );
        const ids = page.data.map((alert) => alert.id);
        expect(ids).toContain(actor.own().alertId);
        expect(ids).not.toContain(aliceRows.alertId);
        await expectOwnedBy('alert', ids, user);
        expect(page.total).toBe(
          await prisma.alert.count({
            where: { userId: user.id, severity: 'CRITICAL' },
          }),
        );
      });

      it(`${role} POST /alerts creates the alert for the caller only`, async () => {
        const user = actor.user();
        const before = await aliceState();
        const title = uniqueName('caller alert');
        await user.agent
          .post('/api/alerts')
          .send({ type: 'SYSTEM', title, message: 'Synthetic caller alert' })
          .expect(201);
        const stored = await prisma.alert.findMany({
          where: { title },
          select: { userId: true },
        });
        expect(stored).toEqual([{ userId: user.id }]);
        expect(await aliceState()).toEqual(before);
      });

      it(`${role} PATCH /alerts/read-all marks only the caller's alerts read; alice's stay unread`, async () => {
        const user = actor.user();
        await user.agent
          .post('/api/alerts')
          .send({
            type: 'SYSTEM',
            title: uniqueName('unread alert'),
            message: 'Synthetic unread alert',
          })
          .expect(201);
        const before = await aliceState();
        expectAliceAlertsUnread(before.alerts);
        await user.agent.patch('/api/alerts/read-all').expect(200);
        expect(
          await prisma.alert.count({
            where: { userId: user.id, isRead: false },
          }),
        ).toBe(0);
        expect(await aliceState()).toEqual(before);
      });
    });

    describe("alert settings: only the caller's settings are read or written", () => {
      it(`${role} PATCH /alerts/settings changes the caller's setting and never alice's`, async () => {
        const user = actor.user();
        const before = await aliceState();
        await user.agent
          .patch('/api/alerts/settings')
          .send({
            type: 'LARGE_TRANSACTION',
            inAppEnabled: true,
            emailEnabled: false,
            threshold: OWN_THRESHOLD,
          })
          .expect(200);
        const stored = await prisma.alertSetting.findUniqueOrThrow({
          where: {
            userId_type: { userId: user.id, type: 'LARGE_TRANSACTION' },
          },
        });
        expect(Number(stored.threshold?.toString())).toBe(OWN_THRESHOLD);
        expect(await aliceState()).toEqual(before);
      });

      it(`${role} GET /alerts/settings returns only the caller's settings`, async () => {
        const user = actor.user();
        const settings = dataOf<AlertSettingView[]>(
          await user.agent.get('/api/alerts/settings').expect(200),
        );
        const ids = settings.map((setting) => setting.id);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of aliceRows.settingIds) {
          expect(ids).not.toContain(id);
        }
        await expectOwnedBy('alertSetting', ids, user);
        expect(
          settings.find((setting) => setting.type === 'LARGE_TRANSACTION')
            ?.threshold,
        ).not.toBe(ALICE_THRESHOLD);
      });
    });

    describe('ownership cannot be reassigned through the request', () => {
      it(`${role} gets 400 for userId in POST /budgets and nothing is created`, async () => {
        const user = actor.user();
        const name = uniqueName('userId budget');
        await user.agent
          .post('/api/budgets')
          .send({
            name,
            amount: 1_000,
            startsAt: BUDGET_START,
            userId: alice.id,
          })
          .expect(400);
        expect(await prisma.budget.count({ where: { name } })).toBe(0);
      });

      it(`${role} gets 400 for userId in PATCH /budgets/:id and the budget keeps its owner`, async () => {
        const user = actor.user();
        const budgetId = actor.own().budgetId;
        const before = await prisma.budget.findUniqueOrThrow({
          where: { id: budgetId },
        });
        await user.agent
          .patch(`/api/budgets/${idPath(budgetId)}`)
          .send({ name: 'E2E moved budget', userId: alice.id })
          .expect(400);
        expect(
          await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } }),
        ).toEqual(before);
      });

      it(`${role} gets 400 for userId in POST /goals and nothing is created`, async () => {
        const user = actor.user();
        const name = uniqueName('userId goal');
        await user.agent
          .post('/api/goals')
          .send({ name, targetAmount: 1_000, userId: alice.id })
          .expect(400);
        expect(await prisma.goal.count({ where: { name } })).toBe(0);
      });

      it(`${role} gets 400 for userId in PATCH /goals/:id and the goal keeps its owner`, async () => {
        const user = actor.user();
        const goalId = actor.own().goalId;
        const before = await prisma.goal.findUniqueOrThrow({
          where: { id: goalId },
        });
        await user.agent
          .patch(`/api/goals/${idPath(goalId)}`)
          .send({ name: 'E2E moved goal', userId: alice.id })
          .expect(400);
        expect(
          await prisma.goal.findUniqueOrThrow({ where: { id: goalId } }),
        ).toEqual(before);
      });

      it(`${role} gets 400 for userId in POST /alerts and nothing is created`, async () => {
        const user = actor.user();
        const title = uniqueName('userId alert');
        await user.agent
          .post('/api/alerts')
          .send({
            type: 'SYSTEM',
            title,
            message: 'Synthetic alert',
            userId: alice.id,
          })
          .expect(400);
        expect(await prisma.alert.count({ where: { title } })).toBe(0);
      });

      it(`${role} gets 400 for userId in PATCH /alerts/settings and alice's settings are unchanged`, async () => {
        const user = actor.user();
        const before = await aliceState();
        await user.agent
          .patch('/api/alerts/settings')
          .send({
            type: 'LARGE_TRANSACTION',
            threshold: OWN_THRESHOLD + 1,
            userId: alice.id,
          })
          .expect(400);
        expect(await aliceState()).toEqual(before);
      });

      it.each([
        ['GET /budgets', '/api/budgets'],
        ['GET /goals', '/api/goals'],
        ['GET /alerts', '/api/alerts'],
      ])(
        `${role} gets 400 for ?userId= on %s (no "view as user" filter)`,
        async (_name, path) => {
          const user = actor.user();
          const response = await user.agent
            .get(`${path}?userId=${idPath(alice.id)}`)
            .expect(400);
          expect(JSON.stringify(response.body ?? {})).not.toContain(ALICE_MARK);
        },
      );
    });
  });

  describe("alice's rows survive the whole matrix", () => {
    it('alice still owns an unarchived budget and goal and two unread alerts with the original values', async () => {
      const state = await aliceState();
      const budget = state.budgets.find((row) => row.id === aliceRows.budgetId);
      const goal = state.goals.find((row) => row.id === aliceRows.goalId);
      expect(budget?.deletedAt).toBeNull();
      expect(budget?.name).toBe(`E2E ${ALICE_MARK} budget`);
      expect(Number(budget?.amount.toString())).toBe(ALICE_BUDGET_AMOUNT);
      expect(budget?.categoryId).toBe(aliceRows.categoryId);
      expect(goal?.deletedAt).toBeNull();
      expect(goal?.name).toBe(`E2E ${ALICE_MARK} goal`);
      expect(Number(goal?.savedAmount.toString())).toBe(1_000_000);
      expectAliceAlertsUnread(state.alerts);
      const large = state.alertSettings.find(
        (setting) => setting.type === 'LARGE_TRANSACTION',
      );
      expect(Number(large?.threshold?.toString())).toBe(ALICE_THRESHOLD);
    });
  });
});
