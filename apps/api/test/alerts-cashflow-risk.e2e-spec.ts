import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { Prisma, TransactionDirection } from '@prisma/client';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryEmailTransport } from './fakes/in-memory-email-transport';
import {
  TestUser,
  cleanupUsers,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import {
  EmailImportHarness,
  MutableClock,
  alertsWithKey,
  createAlertTestApp,
  createTransaction,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T088 (SC-007, ALERT-009 cashflow-risk row, SC-008): the projected net of
 * completed months in the base currency, including the email-eligible
 * CRITICAL path through the in-memory transport and imported transactions.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');
const TODAY = '2026-09-22T10:00:00+07:00';

type Row = {
  time: string;
  direction: TransactionDirection;
  amount: number;
  currency?: string;
};

/** G6 nets: Jun −2,000,000; Jul −1,000,000; Aug −1,500,001 → −1,500,001. */
const G6: Row[] = [
  {
    time: '2026-06-10T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 2_000_000,
  },
  {
    time: '2026-07-10T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 1_000_000,
  },
  {
    time: '2026-08-10T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 1_500_001,
  },
];

describe('Cashflow-risk alerts (T088)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new MutableClock(NOW);
  const transport = new InMemoryEmailTransport();
  const users: TestUser[] = [];
  let harness: EmailImportHarness | undefined;

  const newUser = async (label: string, history: Row[] = []) => {
    const user = await registerUser(app, label);
    users.push(user);
    if (history.length) {
      await prisma.transaction.createMany({
        data: history.map((row) => ({
          userId: user.id,
          amount: new Prisma.Decimal(row.amount),
          currency: row.currency ?? 'VND',
          direction: row.direction,
          transactionTime: new Date(row.time),
          description: 'US5 cashflow history',
        })),
      });
    }
    return user;
  };
  /** Any eligible transaction mutation is a cashflow-risk trigger. */
  const trigger = (user: TestUser) =>
    createTransaction(user.agent, { amount: 1_000, transactionTime: TODAY });
  const cashflow = (user: TestUser) =>
    alertsWithKey(user.agent, `cashflow:${user.id}`);
  const optInEmail = (user: TestUser) =>
    user.agent
      .patch('/api/alerts/settings')
      .send({ type: 'CASHFLOW_RISK', emailEnabled: true })
      .expect(200);

  beforeAll(async () => {
    app = await createAlertTestApp({ clock, transport });
    prisma = app.get(PrismaService);
  });

  beforeEach(() => transport.reset());

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

  it('G6: a negative projection (−1,500,001) opens a CRITICAL alert; email is off by default', async () => {
    const alice = await newUser('us5-cash-g6', G6);
    await trigger(alice);
    const [alert] = await cashflow(alice);
    expect(alert).toMatchObject({
      type: 'CASHFLOW_RISK',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      resourceType: 'user',
      resourceId: alice.id,
      thresholdValue: 0,
      observedValue: -1_500_001,
      periodStart: '2026-05-31T17:00:00.000Z',
      periodEnd: '2026-08-31T17:00:00.000Z',
      metadata: expect.objectContaining({
        observationMonths: '2026-06,2026-07,2026-08',
      }) as object,
      emailDelivery: {
        channel: 'EMAIL',
        status: 'SKIPPED',
        skipReason: 'EMAIL_DISABLED',
        attemptCount: 0,
        lastAttemptAt: null,
        sentAt: null,
        failureCode: null,
      },
    });
    expect(transport.attempts).toBe(0);
  });

  it('opted in: the CRITICAL alert is emailed once after it is recorded, with no financial detail', async () => {
    const bob = await newUser('us5-cash-email', G6);
    await optInEmail(bob);
    await trigger(bob);
    const [alert] = await cashflow(bob);
    expect(alert.emailDelivery).toMatchObject({
      status: 'SENT',
      attemptCount: 1,
      skipReason: null,
    });
    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    expect(message.to).toBe(bob.email);
    expect(message.subject).toBe('CashLens: new critical alert');
    expect(message.text).toContain('Cashflow risk');
    expect(message.text).toContain('https://cashlens.example.test/app/alerts');
    expect(message.text).not.toMatch(/1[,.]?500[,.]?001|VND|-1/);

    // Still open: another trigger sends nothing more.
    await trigger(bob);
    expect(transport.sent).toHaveLength(1);
  });

  it('notifications off: skipped with NOTIFICATIONS_DISABLED even when opted in', async () => {
    const carol = await newUser('us5-cash-muted', G6);
    await optInEmail(carol);
    await carol.agent
      .patch('/api/users/me/settings')
      .send({ notificationEnabled: false })
      .expect(200);
    await trigger(carol);
    const [alert] = await cashflow(carol);
    expect(alert.emailDelivery).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'NOTIFICATIONS_DISABLED',
    });
    expect(transport.attempts).toBe(0);
  });

  it('does not subtract goal commitments: a positive projection never alerts, whatever the goals', async () => {
    const dave = await newUser('us5-cash-goals', [
      {
        time: '2026-07-10T08:00:00+07:00',
        direction: 'INCOME',
        amount: 1_000_000,
      },
      {
        time: '2026-08-10T08:00:00+07:00',
        direction: 'INCOME',
        amount: 1_000_000,
      },
    ]);
    await dave.agent
      .post('/api/goals')
      .send({ name: 'US5 huge', targetAmount: 1e10, targetDate: '2026-10-31' })
      .expect(201);
    await trigger(dave);
    expect(await cashflow(dave)).toEqual([]);
  });

  it('counts only the base currency', async () => {
    const erin = await newUser('us5-cash-usd', [
      {
        time: '2026-07-10T08:00:00+07:00',
        direction: 'EXPENSE',
        amount: 900,
        currency: 'USD',
      },
      {
        time: '2026-08-10T08:00:00+07:00',
        direction: 'EXPENSE',
        amount: 900,
        currency: 'USD',
      },
      { time: '2026-07-11T08:00:00+07:00', direction: 'INCOME', amount: 10 },
      { time: '2026-08-11T08:00:00+07:00', direction: 'INCOME', amount: 10 },
    ]);
    await trigger(erin);
    expect(await cashflow(erin)).toEqual([]);
  });

  it('resolves with INSUFFICIENT_DATA when history shrinks below two completed months', async () => {
    const frank = await newUser('us5-cash-shrink', G6);
    await trigger(frank);
    expect((await cashflow(frank)).map((a) => a.status)).toEqual(['ACTIVE']);
    const history = await prisma.transaction.findMany({
      where: { userId: frank.id, description: 'US5 cashflow history' },
      orderBy: { transactionTime: 'asc' },
    });
    // Remove June and July: only August remains observed.
    for (const row of history.slice(0, 2)) {
      await frank.agent
        .delete(`/api/transactions/${idPath(row.id)}`)
        .expect(200);
    }
    expect(await cashflow(frank)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'INSUFFICIENT_DATA',
      }),
    ]);
  });

  it('resolves when the projection returns to 0 or more', async () => {
    const gina = await newUser('us5-cash-recover', G6);
    await trigger(gina);
    await createTransaction(gina.agent, {
      amount: 4_500_001,
      direction: 'INCOME',
      transactionTime: '2026-08-15T08:00:00+07:00',
    });
    expect(await cashflow(gina)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'BELOW_THRESHOLD',
      }),
    ]);
  });

  it('an imported expense in a completed month opens and emails the CRITICAL alert like a manual one', async () => {
    const importer = await newUser('us5-cash-import', [
      {
        time: '2026-07-10T08:00:00+07:00',
        direction: 'INCOME',
        amount: 1_000_000,
      },
      {
        time: '2026-08-10T08:00:00+07:00',
        direction: 'INCOME',
        amount: 1_000_000,
      },
    ]);
    await optInEmail(importer);
    const created = await EmailImportHarness.create(app, importer, 'us5c');
    harness = created.harness;
    users.push(created.admin);

    harness.queue({ amount: 5_000_000, time: '20/08/2026 09:00:00' });
    expect(await harness.sync()).toMatchObject({
      status: 'SUCCESS',
      transactionsCreated: 1,
    });
    const [alert] = await cashflow(importer);
    // Jul +1,000,000; Aug −4,000,000 → floor(−3,000,000 / 2) = −1,500,000.
    expect(alert).toMatchObject({
      severity: 'CRITICAL',
      status: 'ACTIVE',
      observedValue: -1_500_000,
      emailDelivery: expect.objectContaining({ status: 'SENT' }) as object,
    });
    expect(transport.sent.map((message) => message.to)).toEqual([
      importer.email,
    ]);
  });
});
