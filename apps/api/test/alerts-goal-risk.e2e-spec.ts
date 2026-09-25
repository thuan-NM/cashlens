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
import { H1, LedgerRow, seedLedger } from './fixtures/builders';
import {
  EmailImportHarness,
  MutableClock,
  alertsOf,
  alertsWithKey,
  createAlertTestApp,
  createTransaction,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T087 (SC-007, ALERT-009 goal-risk row, GOAL-002, GOAL-004, SC-008): goal
 * risk from real rows under the data-model example clock, including a change
 * caused by an imported transaction.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');

type Row = LedgerRow;

/** G1: remaining 40,000,000 over Sep–Dec: 10,000,000 a month > 9,000,000. */
const G1 = {
  name: 'US5 car',
  targetAmount: 45_000_000,
  savedAmount: 5_000_000,
  currency: 'VND',
  targetDate: '2026-12-15',
};

describe('Goal-risk alerts (T087)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new MutableClock(NOW);
  const users: TestUser[] = [];
  let harness: EmailImportHarness | undefined;

  const newUser = async (label: string, history: Row[] = H1) => {
    const user = await registerUser(app, label);
    users.push(user);
    await seedLedger(prisma, user.id, history, 'US5 goal history');
    return user;
  };
  const createGoal = async (user: TestUser, body: Record<string, unknown>) =>
    dataOf<{ id: string }>(
      await user.agent.post('/api/goals').send(body).expect(201),
    ).id;
  const statuses = async (user: TestUser, goalId: string) =>
    (await alertsWithKey(user.agent, `goal:${goalId}`)).map((a) => a.status);

  beforeAll(async () => {
    app = await createAlertTestApp({ clock });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await harness?.cleanup();
    if (prisma)
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    await app?.close();
  });

  it('G1: creating the goal opens a GOAL_RISK WARNING with the stored-horizon numbers', async () => {
    const alice = await newUser('us5-goal-g1');
    const goalId = await createGoal(alice, G1);
    const [alert] = await alertsWithKey(alice.agent, `goal:${goalId}`);
    expect(alert).toMatchObject({
      type: 'GOAL_RISK',
      severity: 'WARNING',
      status: 'ACTIVE',
      resourceType: 'goal',
      resourceId: goalId,
      thresholdValue: 9_000_000,
      observedValue: 10_000_000,
      periodStart: '2026-05-31T17:00:00.000Z',
      periodEnd: '2026-08-31T17:00:00.000Z',
      metadata: expect.objectContaining({
        horizonSource: 'TARGET_DATE',
        feasibilityScore: 90,
        feasibilityStatus: 'ACCEPTABLE',
        months: 4,
      }) as object,
      // No transport in this app (EMAIL_TRANSPORT=disabled).
      emailDelivery: expect.objectContaining({
        skipReason: 'TRANSPORT_DISABLED',
      }) as object,
    });
  });

  it('the simulation GET, with or without a what-if horizon, never creates or resolves alerts', async () => {
    const reader = await newUser('us5-goal-read');
    const goalId = (
      await prisma.goal.create({
        data: {
          userId: reader.id,
          name: 'US5 read',
          targetAmount: new Prisma.Decimal(45_000_000),
          savedAmount: new Prisma.Decimal(5_000_000),
          targetDate: new Date('2026-12-15'),
        },
      })
    ).id;
    await reader.agent
      .get(`/api/goals/${idPath(goalId)}/simulation`)
      .expect(200);
    await reader.agent
      .get(`/api/goals/${idPath(goalId)}/simulation?months=1`)
      .expect(200);
    await reader.agent.get(`/api/goals/${idPath(goalId)}`).expect(200);
    await reader.agent.get('/api/goals').expect(200);
    expect(await prisma.alert.count({ where: { userId: reader.id } })).toBe(0);
  });

  it('a contribution that brings the requirement within the available cashflow resolves it', async () => {
    const alice = await newUser('us5-goal-contrib');
    const goalId = await createGoal(alice, G1);
    await alice.agent
      .post(`/api/goals/${idPath(goalId)}/contribution`)
      .send({ amount: 5_000_000 }) // 35,000,000 / 4 = 8,750,000 ≤ 9,000,000
      .expect(201);
    expect(await alertsWithKey(alice.agent, `goal:${goalId}`)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'BELOW_THRESHOLD',
      }),
    ]);
  });

  it('G4: a past deadline holds while the remaining amount exceeds available cashflow', async () => {
    const alice = await newUser('us5-goal-g4');
    const goalId = await createGoal(alice, {
      name: 'US5 late',
      targetAmount: 20_000_000,
      savedAmount: 8_000_000,
      targetDate: '2026-08-31',
    });
    const [alert] = await alertsWithKey(alice.agent, `goal:${goalId}`);
    expect(alert).toMatchObject({
      status: 'ACTIVE',
      observedValue: 12_000_000,
      metadata: expect.objectContaining({
        pastDeadline: true,
        months: 0,
      }) as object,
    });
  });

  it('G5 and the DEFAULT horizon: a reached target or an affordable default horizon never alerts', async () => {
    const alice = await newUser('us5-goal-g5');
    const reached = await createGoal(alice, {
      name: 'US5 done',
      targetAmount: 10_000_000,
      savedAmount: 12_000_000,
      targetDate: '2026-01-31',
    });
    const defaultHorizon = await createGoal(alice, {
      name: 'US5 default',
      targetAmount: 10_000_000,
    });
    expect(await statuses(alice, reached)).toEqual([]);
    expect(await statuses(alice, defaultHorizon)).toEqual([]);
  });

  it.each([
    ['paused', { status: 'PAUSED' }],
    ['completed', { status: 'COMPLETED' }],
  ])('resolves when the goal is %s', async (label, patch) => {
    const alice = await newUser(`us5-goal-${label}`);
    const goalId = await createGoal(alice, G1);
    await alice.agent
      .patch(`/api/goals/${idPath(goalId)}`)
      .send(patch)
      .expect(200);
    expect(await alertsWithKey(alice.agent, `goal:${goalId}`)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'TARGET_REMOVED',
      }),
    ]);
  });

  it('resolves when the goal is deleted (archived)', async () => {
    const alice = await newUser('us5-goal-deleted');
    const goalId = await createGoal(alice, G1);
    await alice.agent.delete(`/api/goals/${idPath(goalId)}`).expect(200);
    expect(await statuses(alice, goalId)).toEqual(['RESOLVED']);
  });

  it('a goal near the Decimal(18,2) maximum still alerts, and later evaluations keep working (review finding)', async () => {
    const alice = await newUser('us5-goal-huge');
    const goalId = await createGoal(alice, {
      name: 'US5 huge',
      targetAmount: 5e14, // required 5e14 in the current month: beyond Decimal(18,4)
      targetDate: '2026-09-30',
    });
    const [alert] = await alertsWithKey(alice.agent, `goal:${goalId}`);
    expect(alert).toMatchObject({
      status: 'ACTIVE',
      thresholdValue: 9_000_000,
      observedValue: null,
      metadata: expect.objectContaining({
        monthlyRequired: '500000000000000',
      }) as object,
    });
    // The failure mode was a rolled-back evaluation for every later trigger.
    const other = await createGoal(alice, G1);
    expect(await statuses(alice, other)).toEqual(['ACTIVE']);
  });

  it('G8: insufficient history never alerts', async () => {
    const alice = await newUser('us5-goal-g8', [
      {
        time: '2026-08-12T08:00:00+07:00',
        direction: 'EXPENSE',
        amount: 5_000_000,
      },
    ]);
    const goalId = await createGoal(alice, { ...G1, targetAmount: 1e10 });
    expect(await statuses(alice, goalId)).toEqual([]);
  });

  it('a manual transaction mutation re-evaluates goal risk', async () => {
    const alice = await newUser('us5-goal-manual');
    const goalId = await createGoal(alice, G1);
    // +2,000,000 in July: available floor(29,000,001 / 3) = 9,666,667 — still below 10,000,000.
    await createTransaction(alice.agent, {
      amount: 2_000_000,
      direction: 'INCOME',
      transactionTime: '2026-07-10T08:00:00+07:00',
    });
    expect(await statuses(alice, goalId)).toEqual(['ACTIVE']);
    // +1,000,000 more: floor(30,000,001 / 3) = 10,000,000, exactly the
    // requirement, so required > available no longer holds.
    await createTransaction(alice.agent, {
      amount: 1_000_000,
      direction: 'INCOME',
      transactionTime: '2026-07-11T08:00:00+07:00',
    });
    expect(await statuses(alice, goalId)).toEqual(['RESOLVED']);
  });

  it('an imported income in a completed month re-evaluates and resolves goal risk', async () => {
    const importer = await newUser('us5-goal-import');
    const goalId = await createGoal(importer, G1);
    expect(await statuses(importer, goalId)).toEqual(['ACTIVE']);

    const created = await EmailImportHarness.create(app, importer, 'us5g');
    harness = created.harness;
    users.push(created.admin);
    harness.queue({
      amount: 10_000_000,
      time: '10/08/2026 09:00:00',
      direction: 'INCOME',
    });
    expect(await harness.sync()).toMatchObject({
      status: 'SUCCESS',
      transactionsCreated: 1,
    });
    // Aug net 20,000,001: available floor(37,000,001 / 3) = 12,333,333.
    expect(await alertsWithKey(importer.agent, `goal:${goalId}`)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'BELOW_THRESHOLD',
      }),
    ]);
    expect(
      (await alertsOf(importer.agent)).filter((a) => a.type === 'GOAL_RISK'),
    ).toHaveLength(1);
  });
});
