import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { Prisma, TransactionDirection } from '@prisma/client';
import { App } from 'supertest/types';
import {
  CompletedMonthCashflow,
  completedMonthCashflow,
} from '../src/common/finance/completed-month-cashflow';
import { Clock } from '../src/common/time/clock';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  absentId,
  cleanupUsers,
  dataOf,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import { H1, LedgerRow, seedLedger } from './fixtures/builders';

jest.setTimeout(120_000);

/** The controlled clock of the data-model worked examples. */
const NOW = new Date('2026-09-23T10:00:00+07:00');
const JUN_AUG = ['2026-06', '2026-07', '2026-08'];

type Row = LedgerRow;

const nets = (observation: CompletedMonthCashflow) =>
  observation.months.map((month) => [month.key, month.net.toFixed()]);

describe('Goals from actual data (US6)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const users: TestUser[] = [];

  const seed = (user: TestUser, rows: Row[]) =>
    seedLedger(prisma, user.id, rows, 'US6 synthetic');

  const newUser = async (label: string) => {
    const user = await registerUser(app, label);
    users.push(user);
    return user;
  };

  beforeAll(async () => {
    // The clock of the worked examples; transactions and goals are real rows.
    app = await createTestApp((builder) =>
      builder.overrideProvider(Clock).useValue({ now: () => new Date(NOW) }),
    );
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma)
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    await app?.close();
  });

  // --- T059: the shared completed-month aggregation, against real rows ------

  describe('completedMonthCashflow (T059)', () => {
    let alice: TestUser;
    const observe = (user: TestUser, currency = 'VND', now = NOW) =>
      completedMonthCashflow(prisma, user.id, currency, now);

    beforeAll(async () => {
      alice = await newUser('us6-cashflow');
      await seed(alice, H1);
    });

    it('observes the 3 most recent completed user months of H1, exactly', async () => {
      expect(await observe(alice)).toMatchObject({
        currency: 'VND',
        historyStartMonth: '2025-01',
      });
      expect(nets(await observe(alice))).toEqual([
        ['2026-06', '9000000'],
        ['2026-07', '8000000'],
        ['2026-08', '10000001'],
      ]);
    });

    it.each<[string, Row]>([
      [
        'the current, incomplete month',
        {
          time: '2026-09-05T08:00:00+07:00',
          direction: 'INCOME',
          amount: 99_000_000,
        },
      ],
      [
        'a transfer in',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'TRANSFER_IN',
          amount: 5_000_000,
        },
      ],
      [
        'a transfer out',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'TRANSFER_OUT',
          amount: 5_000_000,
        },
      ],
      [
        'an adjustment',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'ADJUSTMENT',
          amount: 5_000_000,
        },
      ],
      [
        'a suspected duplicate',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'INCOME',
          amount: 5_000_000,
          isDuplicate: true,
        },
      ],
      [
        'an ignored record',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'INCOME',
          amount: 5_000_000,
          status: 'IGNORED',
        },
      ],
      [
        'a deleted record',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'INCOME',
          amount: 5_000_000,
          status: 'DELETED',
        },
      ],
      [
        'a pending record',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'EXPENSE',
          amount: 5_000_000,
          status: 'PENDING',
        },
      ],
      [
        'a record needing review',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'EXPENSE',
          amount: 5_000_000,
          status: 'NEEDS_REVIEW',
        },
      ],
      [
        'another currency',
        {
          time: '2026-07-10T08:00:00+07:00',
          direction: 'INCOME',
          amount: 5_000,
          currency: 'USD',
        },
      ],
    ])('%s does not count', async (_label, extra) => {
      const before = nets(await observe(alice));
      const created = await prisma.transaction.create({
        data: {
          userId: alice.id,
          amount: new Prisma.Decimal(extra.amount),
          currency: extra.currency ?? 'VND',
          direction: extra.direction,
          status: extra.status ?? 'POSTED',
          isDuplicate: extra.isDuplicate ?? false,
          transactionTime: new Date(extra.time),
        },
      });
      try {
        expect(nets(await observe(alice))).toEqual(before);
      } finally {
        await prisma.transaction.delete({ where: { id: created.id } });
      }
    });

    it('positive control: an eligible record inside the window counts, whatever the stored case of its currency', async () => {
      const created = await prisma.transaction.create({
        data: {
          userId: alice.id,
          amount: new Prisma.Decimal(1_000),
          currency: 'vnd',
          direction: 'INCOME',
          transactionTime: new Date('2026-07-10T08:00:00+07:00'),
        },
      });
      try {
        expect(nets(await observe(alice))[1]).toEqual(['2026-07', '8001000']);
      } finally {
        await prisma.transaction.delete({ where: { id: created.id } });
      }
    });

    it('months are the account user months: the timezone decides the month of a record', async () => {
      // 2026-06-30T20:00Z is already 1 July in Ho Chi Minh City.
      const created = await prisma.transaction.create({
        data: {
          userId: alice.id,
          amount: new Prisma.Decimal(1),
          direction: 'INCOME',
          transactionTime: new Date('2026-06-30T20:00:00Z'),
        },
      });
      try {
        expect(nets(await observe(alice))).toEqual([
          ['2026-06', '9000000'],
          ['2026-07', '8000001'],
          ['2026-08', '10000001'],
        ]);
      } finally {
        await prisma.transaction.delete({ where: { id: created.id } });
      }
    });

    it('G8 and G9: the history starts at the earliest eligible record; empty months count as 0', async () => {
      const cases: Array<[string, Row[], string[][]]> = [
        [
          'current month only',
          [
            {
              time: '2026-09-05T08:00:00+07:00',
              direction: 'INCOME',
              amount: 1,
            },
          ],
          [],
        ],
        [
          'since August',
          [
            {
              time: '2026-08-12T08:00:00+07:00',
              direction: 'INCOME',
              amount: 7,
            },
          ],
          [['2026-08', '7']],
        ],
        [
          'since July',
          [
            {
              time: '2026-07-01T00:00:00+07:00',
              direction: 'EXPENSE',
              amount: 5,
            },
          ],
          [
            ['2026-07', '-5'],
            ['2026-08', '0'],
          ],
        ],
        [
          'G9 since June, no July records',
          [
            {
              time: '2026-06-10T08:00:00+07:00',
              direction: 'INCOME',
              amount: 3_000_000,
            },
            {
              time: '2026-08-10T08:00:00+07:00',
              direction: 'INCOME',
              amount: 6_000_000,
            },
          ],
          [
            ['2026-06', '3000000'],
            ['2026-07', '0'],
            ['2026-08', '6000000'],
          ],
        ],
        [
          // Eligibility is status-based (TX-003): a transfer starts the history.
          'a transfer starts the history',
          [
            {
              time: '2026-07-03T08:00:00+07:00',
              direction: 'TRANSFER_IN',
              amount: 500,
            },
            {
              time: '2026-08-03T08:00:00+07:00',
              direction: 'INCOME',
              amount: 9,
            },
          ],
          [
            ['2026-07', '0'],
            ['2026-08', '9'],
          ],
        ],
        [
          'an ineligible record never starts it',
          [
            {
              time: '2026-03-03T08:00:00+07:00',
              direction: 'INCOME',
              amount: 500,
              status: 'PENDING',
            },
            {
              time: '2026-04-03T08:00:00+07:00',
              direction: 'INCOME',
              amount: 500,
              isDuplicate: true,
            },
            {
              time: '2026-08-03T08:00:00+07:00',
              direction: 'INCOME',
              amount: 9,
            },
          ],
          [['2026-08', '9']],
        ],
      ];
      for (const [label, rows, expected] of cases) {
        const user = await newUser(`us6-history`);
        await seed(user, rows);
        expect([label, nets(await observe(user))]).toEqual([label, expected]);
      }
      const empty = await newUser('us6-empty');
      expect(await observe(empty)).toEqual({
        currency: 'VND',
        historyStartMonth: null,
        months: [],
      });
    });

    it("another owner's records never count, and cents stay exact", async () => {
      const bob = await newUser('us6-bob');
      await seed(bob, [
        {
          time: '2026-06-05T08:00:00+07:00',
          direction: 'INCOME',
          amount: '0.10',
          currency: 'USD',
        },
        {
          time: '2026-06-06T08:00:00+07:00',
          direction: 'INCOME',
          amount: '0.20',
          currency: 'USD',
        },
        {
          time: '2026-07-05T08:00:00+07:00',
          direction: 'INCOME',
          amount: 77_777_777,
        },
      ]);
      expect(nets(await observe(alice))).toEqual([
        ['2026-06', '9000000'],
        ['2026-07', '8000000'],
        ['2026-08', '10000001'],
      ]);
      expect(nets(await observe(bob, 'usd'))).toEqual([
        ['2026-06', '0.3'],
        ['2026-07', '0'],
        ['2026-08', '0'],
      ]);
    });

    it('agrees with the dashboard cashflow for the same months (one shared policy)', async () => {
      const response = await alice.agent
        .get('/api/dashboard/cashflow')
        .query({ month: '2026-08' })
        .expect(200);
      const trend =
        dataOf<Array<{ month: string; netCashflow: number }>>(response);
      const dashboard = trend
        .filter((entry) => JUN_AUG.includes(entry.month))
        .map((entry) => [entry.month, String(entry.netCashflow)]);
      expect(dashboard).toEqual(nets(await observe(alice)));
    });

    it('matches stored codes that differ only in case or padding; a free-form goal currency is never a pattern', async () => {
      const padded = await prisma.transaction.create({
        data: {
          userId: alice.id,
          amount: new Prisma.Decimal(3),
          currency: ' vnd ',
          direction: 'INCOME',
          transactionTime: new Date('2026-08-10T08:00:00+07:00'),
        },
      });
      try {
        expect(nets(await observe(alice))[2]).toEqual(['2026-08', '10000004']);
        // '%' or '_' would be SQL wildcards in a LIKE match.
        for (const code of ['%', 'V_D', '%%%']) {
          expect([code, await observe(alice, code)]).toEqual([
            code,
            { currency: code, historyStartMonth: null, months: [] },
          ]);
        }
      } finally {
        await prisma.transaction.delete({ where: { id: padded.id } });
      }
    });

    it('the month boundary is the account month start: the last second of August counts, the first of September does not', async () => {
      const user = await newUser('us6-boundary');
      await seed(user, [
        { time: '2026-07-10T08:00:00+07:00', direction: 'INCOME', amount: 1 },
        { time: '2026-08-31T23:59:59+07:00', direction: 'INCOME', amount: 10 },
        {
          time: '2026-09-01T00:00:00+07:00',
          direction: 'INCOME',
          amount: 1_000,
        },
      ]);
      expect(nets(await observe(user))).toEqual([
        ['2026-07', '1'],
        ['2026-08', '10'],
      ]);
    });

    it('an earlier record in another currency does not start the history', async () => {
      const user = await newUser('us6-other-start');
      await seed(user, [
        {
          time: '2025-02-10T08:00:00+07:00',
          direction: 'INCOME',
          amount: 9,
          currency: 'USD',
        },
        { time: '2026-08-12T08:00:00+07:00', direction: 'INCOME', amount: 7 },
      ]);
      expect(await observe(user)).toMatchObject({
        historyStartMonth: '2026-08',
      });
      expect(nets(await observe(user))).toEqual([['2026-08', '7']]);
    });
  });

  // --- T061/T063: feasibility through the API, from persisted transactions ---

  describe('goal feasibility through the API (T061, T063)', () => {
    type Feasibility = {
      goalId: string;
      scenario: string;
      months: number;
      horizonSource: string;
      pastDeadline: boolean;
      targetAmount: number;
      savedAmount: number;
      remainingAmount: number;
      totalCost: number;
      monthlyRequired: number;
      feasibilityScore: number | null;
      status: string;
      availableMonthlyCashflow: number | null;
      observationMonths: string[];
      monthsRequired: number;
      reason: string;
    };

    /** A manual transaction through the public API. */
    const record = async (
      user: TestUser,
      time: string,
      direction: TransactionDirection,
      amount: number,
    ) =>
      dataOf<{ id: string }>(
        await user.agent
          .post('/api/transactions')
          .send({
            amount,
            currency: 'VND',
            direction,
            transactionTime: time,
            description: 'US6 API synthetic',
          })
          .expect(201),
      ).id;

    /** H1 through the API; returns the ids by role. */
    const recordH1 = async (user: TestUser) => ({
      start: await record(user, '2025-01-10T08:00:00+07:00', 'EXPENSE', 50_000),
      junIncome: await record(
        user,
        '2026-06-05T08:00:00+07:00',
        'INCOME',
        9_000_000,
      ),
      julIncome: await record(
        user,
        '2026-07-05T08:00:00+07:00',
        'INCOME',
        10_000_000,
      ),
      julExpense: await record(
        user,
        '2026-07-20T08:00:00+07:00',
        'EXPENSE',
        2_000_000,
      ),
      augIncome: await record(
        user,
        '2026-08-05T08:00:00+07:00',
        'INCOME',
        12_000_001,
      ),
      augExpense: await record(
        user,
        '2026-08-20T08:00:00+07:00',
        'EXPENSE',
        2_000_000,
      ),
    });

    const createGoal = async (user: TestUser, body: Record<string, unknown>) =>
      dataOf<{ id: string; remainingAmount: number }>(
        await user.agent
          .post('/api/goals')
          .send({ name: 'US6 goal', ...body })
          .expect(201),
      );

    const simulation = (
      user: TestUser,
      id: string,
      query: Record<string, string> = {},
    ) => user.agent.get(`/api/goals/${idPath(id)}/simulation`).query(query);

    const simulate = async (
      user: TestUser,
      id: string,
      query: Record<string, string> = {},
    ) => dataOf<Feasibility>(await simulation(user, id, query).expect(200));

    const errorBody = (response: { body: Record<string, unknown> }) => {
      const body = { ...response.body };
      delete body.timestamp;
      delete body.correlationId; // per request (T093)
      delete body.path;
      return body;
    };

    let owner: TestUser;
    let g1: string;

    beforeAll(async () => {
      owner = await newUser('us6-api-owner');
      await recordH1(owner);
      g1 = (
        await createGoal(owner, {
          targetAmount: 45_000_000,
          savedAmount: 5_000_000,
          targetDate: '2026-12-15',
        })
      ).id;
    });

    it('G1 from persisted transactions: the enveloped GoalFeasibility, exactly', async () => {
      const response = await simulation(owner, g1).expect(200);
      expect(response.body).toEqual({
        success: true,
        message: expect.any(String) as string,
        timestamp: expect.any(String) as string,
        correlationId: expect.any(String) as string, // additive (T093)
        data: {
          goalId: g1,
          scenario: 'FULL',
          months: 4,
          horizonSource: 'TARGET_DATE',
          pastDeadline: false,
          targetAmount: 45_000_000,
          savedAmount: 5_000_000,
          remainingAmount: 40_000_000,
          totalCost: 40_000_000,
          monthlyRequired: 10_000_000,
          feasibilityScore: 90,
          status: 'ACCEPTABLE',
          availableMonthlyCashflow: 9_000_000,
          observationMonths: JUN_AUG,
          monthsRequired: 0,
          reason: 'COMPLETED_MONTHS_AVERAGE',
        },
      });
      // Reading twice under the same clock gives the same result (GOAL-006).
      expect(await simulate(owner, g1)).toEqual(
        (response.body as { data: Feasibility }).data,
      );
    });

    it('G4 past deadline and G5 target complete, from the same history', async () => {
      const g4 = await createGoal(owner, {
        targetAmount: 20_000_000,
        savedAmount: 8_000_000,
        targetDate: '2026-08-31',
      });
      expect(await simulate(owner, g4.id)).toMatchObject({
        months: 0,
        horizonSource: 'TARGET_DATE',
        pastDeadline: true,
        remainingAmount: 12_000_000,
        monthlyRequired: 12_000_000,
        availableMonthlyCashflow: 9_000_000,
        feasibilityScore: 75,
        status: 'RISKY',
        reason: 'PAST_DEADLINE',
      });
      const g5 = await createGoal(owner, {
        targetAmount: 10_000_000,
        savedAmount: 12_000_000,
        targetDate: '2026-08-31',
      });
      expect(await simulate(owner, g5.id)).toMatchObject({
        months: 0,
        pastDeadline: false,
        remainingAmount: 0,
        monthlyRequired: 0,
        feasibilityScore: 100,
        status: 'SAFE',
        reason: 'TARGET_REACHED',
      });
      expect(g5.remainingAmount).toBe(0);
    });

    it('G10(b) the visible default horizon, and the what-if horizon (QUERY)', async () => {
      const goal = await createGoal(owner, { targetAmount: 10_000_000 });
      expect(await simulate(owner, goal.id)).toMatchObject({
        horizonSource: 'DEFAULT',
        months: 6,
        monthlyRequired: 1_666_667, // ceil(10,000,000 / 6)
      });
      expect(await simulate(owner, goal.id, { months: '3' })).toMatchObject({
        horizonSource: 'QUERY',
        months: 3,
        monthlyRequired: 3_333_334,
        feasibilityScore: 100,
        status: 'SAFE',
      });
    });

    it('INSTALLMENT is accepted without an inferred rate: FULL numbers, and the reason says so', async () => {
      const full = await simulate(owner, g1);
      expect(await simulate(owner, g1, { scenario: 'INSTALLMENT' })).toEqual({
        ...full,
        scenario: 'INSTALLMENT',
        totalCost: full.remainingAmount,
        reason: 'COMPLETED_MONTHS_AVERAGE, INSTALLMENT_WITHOUT_INTEREST',
      });
    });

    it('G6 negative history through the API', async () => {
      const user = await newUser('us6-api-g6');
      await record(user, '2026-06-05T08:00:00+07:00', 'EXPENSE', 2_000_000);
      await record(user, '2026-07-05T08:00:00+07:00', 'EXPENSE', 1_000_000);
      await record(user, '2026-08-05T08:00:00+07:00', 'EXPENSE', 1_500_001);
      const goal = await createGoal(user, { targetAmount: 20_000_000 });
      expect(await simulate(user, goal.id, { months: '2' })).toMatchObject({
        months: 2,
        horizonSource: 'QUERY',
        monthlyRequired: 10_000_000,
        availableMonthlyCashflow: -1_500_001,
        feasibilityScore: 0,
        status: 'NOT_RECOMMENDED',
        observationMonths: JUN_AUG,
      });
    });

    it.each([
      ['2026-09-05T08:00:00+07:00', [], null, 2, 'INSUFFICIENT_DATA'],
      ['2026-08-12T08:00:00+07:00', ['2026-08'], null, 1, 'INSUFFICIENT_DATA'],
      [
        '2026-07-01T08:00:00+07:00',
        ['2026-07', '2026-08'],
        2_500_000,
        0,
        'SAFE', // floor(2,500,000 x 100 / 1,666,667) = 149, capped to 100
      ],
      ['2026-03-01T08:00:00+07:00', JUN_AUG, 0, 0, 'NOT_RECOMMENDED'],
    ])(
      'G8 history starting %s through the API',
      async (start, months, available, monthsRequired, status) => {
        const user = await newUser('us6-api-g8');
        await record(user, start, 'INCOME', 5_000_000);
        const goal = await createGoal(user, { targetAmount: 10_000_000 });
        // Default horizon: 6 periods, required 1,666,667.
        expect(await simulate(user, goal.id)).toMatchObject({
          observationMonths: months,
          availableMonthlyCashflow: available,
          monthsRequired,
          status,
          feasibilityScore:
            available === null ? null : (expect.any(Number) as number),
          reason:
            available === null
              ? 'INSUFFICIENT_HISTORY'
              : 'COMPLETED_MONTHS_AVERAGE',
        });
      },
    );

    it('recalculates on every goal, contribution, and transaction change (GOAL-006)', async () => {
      const user = await newUser('us6-api-recalc');
      const ids = await recordH1(user);
      const goal = (
        await createGoal(user, {
          targetAmount: 45_000_000,
          savedAmount: 5_000_000,
          targetDate: '2026-12-15',
        })
      ).id;
      const pick = (result: Feasibility) => ({
        monthlyRequired: result.monthlyRequired,
        availableMonthlyCashflow: result.availableMonthlyCashflow,
        feasibilityScore: result.feasibilityScore,
        status: result.status,
      });
      expect(pick(await simulate(user, goal))).toEqual({
        monthlyRequired: 10_000_000,
        availableMonthlyCashflow: 9_000_000,
        feasibilityScore: 90,
        status: 'ACCEPTABLE',
      });

      // A contribution: saved 9,000,000, so 36,000,000 over 4 periods.
      await user.agent
        .post(`/api/goals/${idPath(goal)}/contribution`)
        .send({ amount: 4_000_000 })
        .expect(201);
      expect(pick(await simulate(user, goal))).toEqual({
        monthlyRequired: 9_000_000,
        availableMonthlyCashflow: 9_000_000,
        feasibilityScore: 100,
        status: 'SAFE',
      });

      // A goal edit: the deadline moves to October, 2 periods.
      await user.agent
        .patch(`/api/goals/${idPath(goal)}`)
        .send({ targetDate: '2026-10-15' })
        .expect(200);
      expect(pick(await simulate(user, goal))).toEqual({
        monthlyRequired: 18_000_000,
        availableMonthlyCashflow: 9_000_000,
        feasibilityScore: 50,
        status: 'RISKY',
      });

      // An ignored income: August nets -2,000,000.
      await user.agent
        .patch(`/api/transactions/${idPath(ids.augIncome)}/ignore`)
        .expect(200);
      expect(pick(await simulate(user, goal))).toEqual({
        monthlyRequired: 18_000_000,
        availableMonthlyCashflow: 5_000_000, // 15,000,000 / 3
        feasibilityScore: 27,
        status: 'NOT_RECOMMENDED',
      });

      // A deleted expense: July nets 10,000,000.
      await user.agent
        .delete(`/api/transactions/${idPath(ids.julExpense)}`)
        .expect(200);
      expect(pick(await simulate(user, goal))).toEqual({
        monthlyRequired: 18_000_000,
        availableMonthlyCashflow: 5_666_666, // floor(17,000,000 / 3)
        feasibilityScore: 31,
        status: 'NOT_RECOMMENDED',
      });

      // An edited amount: June income 12,000,000.
      await user.agent
        .patch(`/api/transactions/${idPath(ids.junIncome)}`)
        .send({ amount: 12_000_000 })
        .expect(200);
      expect(pick(await simulate(user, goal))).toEqual({
        monthlyRequired: 18_000_000,
        availableMonthlyCashflow: 6_666_666, // floor(20,000,000 / 3)
        feasibilityScore: 37,
        status: 'NOT_RECOMMENDED',
      });

      // A record in the current, incomplete month changes nothing.
      const before = await simulate(user, goal);
      await record(user, '2026-09-05T08:00:00+07:00', 'INCOME', 99_000_000);
      expect(await simulate(user, goal)).toEqual(before);

      // Clearing the target date: no planned months, so the visible default
      // horizon applies again (36,000,000 over 6 periods).
      const cleared = dataOf<{ targetDate: string | null }>(
        await user.agent
          .patch(`/api/goals/${idPath(goal)}`)
          .send({ targetDate: null })
          .expect(200),
      );
      expect(cleared.targetDate).toBeNull();
      expect(await simulate(user, goal)).toMatchObject({
        horizonSource: 'DEFAULT',
        months: 6,
        monthlyRequired: 6_000_000,
      });
    });

    it("another owner's same-currency history never changes the result, and another owner's goal is not found", async () => {
      const before = await simulate(owner, g1);
      const bob = await newUser('us6-api-bob');
      await record(bob, '2024-05-10T08:00:00+07:00', 'INCOME', 1_000_000);
      await record(bob, '2026-06-10T08:00:00+07:00', 'EXPENSE', 50_000_000);
      await record(bob, '2026-08-10T08:00:00+07:00', 'INCOME', 70_000_000);
      expect(await simulate(owner, g1)).toEqual(before);

      const foreign = await simulation(bob, g1);
      const absent = await simulation(bob, absentId());
      expect(absent.status).toBe(404);
      expect({ status: foreign.status, body: errorBody(foreign) }).toEqual({
        status: 404,
        body: errorBody(absent),
      });
    });

    it.each([
      ['months=0', { months: '0' }],
      ['months=abc', { months: 'abc' }],
      ['months=1.5', { months: '1.5' }],
      ['scenario=BAD', { scenario: 'BAD' }],
    ])(
      '%s is a 400 field error, the same for an own and an absent goal',
      async (_label, query) => {
        const own = await simulation(owner, g1, query).expect(400);
        const absent = await simulation(owner, absentId(), query).expect(400);
        expect(errorBody(own)).toEqual(errorBody(absent));
        expect(JSON.stringify(own.body)).toMatch(
          new RegExp(Object.keys(query)[0]),
        );
      },
    );

    it('a goal whose currency is not a real code observes nothing, whatever history exists', async () => {
      const goal = await createGoal(owner, {
        targetAmount: 10_000_000,
        currency: '%',
      });
      expect(await simulate(owner, goal.id)).toMatchObject({
        observationMonths: [],
        status: 'INSUFFICIENT_DATA',
        monthsRequired: 2,
      });
    });

    it('goal CRUD keeps exact amounts and owner scope; an archived goal is not found (GOAL-001)', async () => {
      const goal = await createGoal(owner, {
        targetAmount: 0.3,
        savedAmount: 0.1,
        currency: 'USD',
        months: 12,
      });
      expect(goal.remainingAmount).toBe(0.2);
      expect((await simulate(owner, goal.id)).remainingAmount).toBe(0.2);
      const listed = dataOf<Array<{ id: string }>>(
        await owner.agent.get('/api/goals').expect(200),
      );
      expect(listed.map((item) => item.id)).toContain(goal.id);
      await owner.agent.delete(`/api/goals/${idPath(goal.id)}`).expect(200);
      expect(
        dataOf<Array<{ id: string }>>(
          await owner.agent.get('/api/goals').expect(200),
        ).map((item) => item.id),
      ).not.toContain(goal.id);
      await owner.agent.get(`/api/goals/${idPath(goal.id)}`).expect(404);
      await simulation(owner, goal.id).expect(404);
    });

    it('reading feasibility never creates or resolves alerts', async () => {
      const count = () => prisma.alert.count({ where: { userId: owner.id } });
      const before = await count();
      await simulate(owner, g1);
      await simulate(owner, g1, { months: '1' });
      expect(await count()).toBe(before);
    });
  });
});
