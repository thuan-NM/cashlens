import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { Prisma, TransactionDirection } from '@prisma/client';
import { App } from 'supertest/types';
import { AlertsRepository } from '../src/modules/alerts/alerts.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryEmailTransport } from './fakes/in-memory-email-transport';
import {
  TestUser,
  absentId,
  cleanupUsers,
  dataOf,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import {
  AlertView,
  HOUR,
  MutableClock,
  alertsOf,
  alertsWithKey,
  createAlertTestApp,
  createCategory,
  createTransaction,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T091 (SC-007, ALERT-001, ALERT-004–ALERT-008, ALERT-010, ALERT-011): the
 * lifecycle, read state, and email delivery end to end, with the in-memory
 * transport and a controlled clock. The TRANSPORT_DISABLED outcome needs an
 * app without a transport; it is asserted in alerts-budget.e2e-spec.ts.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');
const TODAY = '2026-09-22T10:00:00+07:00';

/** G6 nets: a CRITICAL cashflow-risk condition at the next trigger. */
const G6: [string, number][] = [
  ['2026-06-10T08:00:00+07:00', 2_000_000],
  ['2026-07-10T08:00:00+07:00', 1_000_000],
  ['2026-08-10T08:00:00+07:00', 1_500_001],
];

describe('Alert lifecycle and delivery (T091)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new MutableClock(NOW);
  const transport = new InMemoryEmailTransport();
  const users: TestUser[] = [];

  const newUser = async (label: string, negativeHistory = false) => {
    const user = await registerUser(app, label);
    users.push(user);
    if (negativeHistory) {
      await prisma.transaction.createMany({
        data: G6.map(([time, amount]) => ({
          userId: user.id,
          amount: new Prisma.Decimal(amount),
          direction: TransactionDirection.EXPENSE,
          transactionTime: new Date(time),
          description: 'US5 lifecycle history',
        })),
      });
    }
    return user;
  };
  const trigger = (user: TestUser, amount = 1_000) =>
    createTransaction(user.agent, { amount, transactionTime: TODAY });
  const optIn = (user: TestUser, type = 'CASHFLOW_RISK') =>
    user.agent
      .patch('/api/alerts/settings')
      .send({ type, emailEnabled: true })
      .expect(200);
  const cashflowAlert = async (user: TestUser) =>
    (await alertsWithKey(user.agent, `cashflow:${user.id}`))[0];

  beforeAll(async () => {
    app = await createAlertTestApp({
      clock,
      transport,
      // Backoff (500 + 1000 ms) counts against the budget, so it must fit.
      delivery: { attemptTimeoutMs: 200, totalBudgetMs: 2000 },
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    clock.set(NOW);
    transport.reset();
  });

  afterAll(async () => {
    if (prisma)
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    await app?.close();
  });

  describe('evaluator-created alerts (ALERT-001, ALERT-008)', () => {
    it('carry type, severity, target, key, window, threshold, observed value, trigger time, and a sanitized explanation', async () => {
      const alice = await newUser('us5-life-fields', true);
      const categoryId = await createCategory(alice.agent, 'US5 fields');
      await alice.agent
        .post('/api/budgets')
        .send({
          name: 'US5 fields',
          amount: 1_000_000,
          categoryId,
          startsAt: '2026-01-01',
        })
        .expect(201);
      await createTransaction(alice.agent, {
        amount: 6_000_000,
        categoryId,
        transactionTime: TODAY,
      });
      const alerts = (await alertsOf(alice.agent)).filter(
        (alert) => alert.conditionKey !== null,
      );
      expect(alerts.map((alert) => alert.type).sort()).toEqual([
        'BUDGET_THRESHOLD',
        'BUDGET_THRESHOLD',
        'CASHFLOW_RISK',
        'LARGE_TRANSACTION',
      ]);
      for (const alert of alerts) {
        expect(alert).toMatchObject({
          status: 'ACTIVE',
          severity: expect.stringMatching(/^(WARNING|CRITICAL)$/) as string,
          resourceType: expect.any(String) as string,
          resourceId: expect.any(String) as string,
          conditionKey: expect.any(String) as string,
          thresholdValue: expect.any(Number) as number,
          observedValue: expect.any(Number) as number,
          periodStart: expect.any(String) as string,
          periodEnd: expect.any(String) as string,
          triggeredAt: NOW.toISOString(),
          metadata: expect.any(Object) as object,
          emailDelivery: expect.objectContaining({
            channel: 'EMAIL',
          }) as object,
        });
        expect(alert.title.length).toBeGreaterThan(0);
        expect(alert.message.length).toBeGreaterThan(0);
        // No secret, address, or raw email text in the explanation.
        expect(JSON.stringify(alert)).not.toContain(alice.email);
      }
    });

    it('never produce CATEGORY_SHIFT or PARSER_ISSUE', async () => {
      const keyed = await prisma.alert.findMany({
        where: {
          userId: { in: users.map((user) => user.id) },
          conditionKey: { not: null },
        },
        select: { type: true },
      });
      expect(keyed.length).toBeGreaterThan(0);
      expect(
        keyed.filter(
          (alert) =>
            alert.type === 'CATEGORY_SHIFT' || alert.type === 'PARSER_ISSUE',
        ),
      ).toEqual([]);
    });
  });

  describe('read state is independent of status (ALERT-010)', () => {
    it('reading changes only isRead/readAt; resolution keeps the read state', async () => {
      const bob = await newUser('us5-life-read', true);
      await trigger(bob);
      const alert = await cashflowAlert(bob);
      await bob.agent.patch(`/api/alerts/${idPath(alert.id)}/read`).expect(200);
      const read = await cashflowAlert(bob);
      expect(read).toMatchObject({ status: 'ACTIVE', isRead: true });
      expect(read.readAt).not.toBeNull();

      // Recover: income resolves the condition; the read state is kept.
      await createTransaction(bob.agent, {
        amount: 9_000_000,
        direction: 'INCOME',
        transactionTime: '2026-08-15T08:00:00+07:00',
      });
      expect(await cashflowAlert(bob)).toMatchObject({
        status: 'RESOLVED',
        isRead: true,
        readAt: read.readAt,
      });
    });

    it('read-all marks every alert read without changing any status; the unread count follows isRead only', async () => {
      const carol = await newUser('us5-life-count', true);
      await trigger(carol); // ACTIVE cashflow risk
      await carol.agent
        .post('/api/alerts')
        .send({ type: 'SYSTEM', title: 'US5 note', message: 'User-authored' })
        .expect(201);
      const count = async () =>
        dataOf<{ count: number }>(
          await carol.agent.get('/api/alerts/unread-count').expect(200),
        ).count;
      expect(await count()).toBe(2);

      const before = await alertsOf(carol.agent);
      await carol.agent.patch('/api/alerts/read-all').expect(200);
      const after = await alertsOf(carol.agent);
      expect(after.map((alert) => alert.status)).toEqual(
        before.map((alert) => alert.status),
      );
      expect(after.every((alert) => alert.isRead)).toBe(true);
      expect(await count()).toBe(0);
    });

    it('filters by status and by isRead ("false" is false)', async () => {
      const dan = await newUser('us5-life-filter', true);
      await trigger(dan);
      await createTransaction(dan.agent, {
        amount: 9_000_000,
        direction: 'INCOME',
        transactionTime: '2026-08-15T08:00:00+07:00',
      }); // resolves
      await dan.agent
        .post('/api/alerts')
        .send({ type: 'SYSTEM', title: 'US5 open', message: 'User-authored' })
        .expect(201);
      const resolved = await alertsOf(dan.agent, { status: 'RESOLVED' });
      expect(resolved.map((alert) => alert.conditionKey)).toEqual([
        `cashflow:${dan.id}`,
      ]);
      const active = await alertsOf(dan.agent, { status: 'ACTIVE' });
      expect(active.map((alert) => alert.conditionKey)).toEqual([null]);
      expect(await alertsOf(dan.agent, { isRead: 'false' })).toHaveLength(2);
      expect(await alertsOf(dan.agent, { isRead: 'true' })).toHaveLength(0);
      await dan.agent.get('/api/alerts?status=OPEN').expect(400);
      await dan.agent.get('/api/alerts?isRead=maybe').expect(400);
    });
  });

  describe('dismiss (ALERT-004, ALERT-010)', () => {
    it('dismisses, marks read, blocks re-alerting while the condition holds, and keeps dismissedAt on resolution', async () => {
      const erin = await newUser('us5-life-dismiss', true);
      await trigger(erin);
      const alert = await cashflowAlert(erin);

      clock.advance(HOUR);
      const dismissed = dataOf<AlertView>(
        await erin.agent
          .patch(`/api/alerts/${idPath(alert.id)}/dismiss`)
          .expect(200),
      );
      const dismissedAt = new Date(NOW.getTime() + HOUR).toISOString();
      expect(dismissed).toMatchObject({
        status: 'DISMISSED',
        dismissedAt,
        isRead: true,
        readAt: expect.any(String) as string,
      });

      // Dismissing again changes nothing.
      expect(
        dataOf<AlertView>(
          await erin.agent
            .patch(`/api/alerts/${idPath(alert.id)}/dismiss`)
            .expect(200),
        ),
      ).toMatchObject({ status: 'DISMISSED', dismissedAt });

      // Two days later the condition still holds: no duplicate.
      clock.advance(48 * HOUR);
      await trigger(erin);
      expect(
        await alertsWithKey(erin.agent, `cashflow:${erin.id}`),
      ).toHaveLength(1);

      // It resolves from DISMISSED and keeps the dismissal time.
      await createTransaction(erin.agent, {
        amount: 9_000_000,
        direction: 'INCOME',
        transactionTime: '2026-08-15T08:00:00+07:00',
      });
      expect(await cashflowAlert(erin)).toMatchObject({
        status: 'RESOLVED',
        dismissedAt,
        resolutionReason: 'BELOW_THRESHOLD',
      });

      // A resolved alert cannot be dismissed.
      const conflict = await erin.agent
        .patch(`/api/alerts/${idPath(alert.id)}/dismiss`)
        .expect(409);
      expect(conflict.body).toMatchObject({ code: 'ALERT_RESOLVED' });
    });

    it("is owner-safe: another user's alert and an absent id are both 404", async () => {
      const owner = await newUser('us5-life-owner', true);
      const other = await newUser('us5-life-other');
      await trigger(owner);
      const alert = await cashflowAlert(owner);
      await other.agent
        .patch(`/api/alerts/${idPath(alert.id)}/dismiss`)
        .expect(404);
      await other.agent
        .patch(`/api/alerts/${idPath(absentId())}/dismiss`)
        .expect(404);
      expect(await cashflowAlert(owner)).toMatchObject({ status: 'ACTIVE' });
      expect(
        dataOf<{ count: number }>(
          await other.agent.get('/api/alerts/unread-count').expect(200),
        ).count,
      ).toBe(0);
    });
  });

  describe('legacy and user-authored alerts (ALERT-011)', () => {
    it('POST /alerts rows carry no key and no delivery; evaluators never touch them or legacy rows', async () => {
      const fay = await newUser('us5-life-legacy', true);
      const posted = dataOf<AlertView>(
        await fay.agent
          .post('/api/alerts')
          .send({
            type: 'CASHFLOW_RISK',
            severity: 'CRITICAL',
            title: 'US5 authored',
            message: 'User-authored cashflow note',
            resourceType: 'user',
            resourceId: fay.id,
          })
          .expect(201),
      );
      expect(posted).toMatchObject({
        status: 'ACTIVE',
        conditionKey: null,
        emailDelivery: null,
      });
      // A row written before this release: only the old columns.
      const legacy = await prisma.alert.create({
        data: {
          userId: fay.id,
          type: 'BUDGET_THRESHOLD',
          severity: 'WARNING',
          title: 'US5 legacy',
          message: 'Pre-release alert',
          createdAt: new Date('2026-01-02T03:04:05Z'),
          triggeredAt: new Date('2026-01-02T03:04:05Z'),
        },
      });
      await optIn(fay);
      await trigger(fay); // opens the keyed cashflow alert and emails it
      await createTransaction(fay.agent, {
        amount: 9_000_000,
        direction: 'INCOME',
        transactionTime: '2026-08-15T08:00:00+07:00',
      }); // resolves the keyed one

      const all = await alertsOf(fay.agent);
      expect(all.find((alert) => alert.id === posted.id)).toMatchObject({
        status: 'ACTIVE',
        conditionKey: null,
        emailDelivery: null,
        resolvedAt: null,
      });
      expect(all.find((alert) => alert.id === legacy.id)).toMatchObject({
        status: 'ACTIVE',
        conditionKey: null,
        emailDelivery: null,
        triggeredAt: '2026-01-02T03:04:05.000Z',
      });
      expect(
        await prisma.alertDelivery.count({
          where: { alertId: { in: [posted.id, legacy.id] } },
        }),
      ).toBe(0);
      expect(transport.sent).toHaveLength(1); // only the keyed alert
    });
  });

  describe('email delivery (ALERT-005–ALERT-007)', () => {
    it('settings: email defaults to off for every type, is available, and requires in-app; thresholds must be positive', async () => {
      const gus = await newUser('us5-life-settings');
      const settings = dataOf<
        {
          type: string;
          emailEnabled: boolean;
          inAppEnabled: boolean;
          emailAvailable: boolean;
        }[]
      >(await gus.agent.get('/api/alerts/settings').expect(200));
      expect(settings).toHaveLength(7);
      for (const setting of settings) {
        expect(setting).toMatchObject({
          emailEnabled: false,
          inAppEnabled: true,
          emailAvailable: true,
        });
      }
      await gus.agent
        .patch('/api/alerts/settings')
        .send({
          type: 'CASHFLOW_RISK',
          inAppEnabled: false,
          emailEnabled: true,
        })
        .expect(400);
      await optIn(gus);
      await gus.agent
        .patch('/api/alerts/settings')
        .send({ type: 'CASHFLOW_RISK', inAppEnabled: false })
        .expect(400);
      await gus.agent
        .patch('/api/alerts/settings')
        .send({ type: 'LARGE_TRANSACTION', threshold: 0 })
        .expect(400);
      await gus.agent
        .patch('/api/alerts/settings')
        .send({ type: 'LARGE_TRANSACTION', threshold: -5 })
        .expect(400);
    });

    it.each([
      ['a WARNING', 'NOT_CRITICAL'],
      ['email not enabled for the type', 'EMAIL_DISABLED'],
      ['notifications off', 'NOTIFICATIONS_DISABLED'],
    ])('records exactly one SKIPPED outcome for %s', async (label, reason) => {
      const user = await newUser(`us5-life-skip-${reason.toLowerCase()}`, true);
      if (reason === 'NOTIFICATIONS_DISABLED') {
        await optIn(user);
        await user.agent
          .patch('/api/users/me/settings')
          .send({ notificationEnabled: false })
          .expect(200);
      }
      if (reason === 'NOT_CRITICAL') {
        await optIn(user, 'LARGE_TRANSACTION');
        const id = await trigger(user, 6_000_000);
        const [alert] = await alertsWithKey(user.agent, `large-tx:${id}`);
        expect(alert.emailDelivery).toMatchObject({
          status: 'SKIPPED',
          skipReason: reason,
          attemptCount: 0,
        });
      } else {
        await trigger(user);
        expect((await cashflowAlert(user)).emailDelivery).toMatchObject({
          status: 'SKIPPED',
          skipReason: reason,
          attemptCount: 0,
        });
      }
      expect(transport.attempts).toBe(0);
      const alertIds = (await alertsOf(user.agent))
        .filter((alert) => alert.conditionKey !== null)
        .map((alert) => alert.id);
      expect(
        await prisma.alertDelivery.count({
          where: { alertId: { in: alertIds } },
        }),
      ).toBe(alertIds.length);
    });

    it('retries temporary failures: sent on the third and last attempt', async () => {
      const hal = await newUser('us5-life-retry', true);
      await optIn(hal);
      transport.script = ['TEMPORARY', 'TIMEOUT'];
      await trigger(hal);
      expect((await cashflowAlert(hal)).emailDelivery).toMatchObject({
        status: 'SENT',
        attemptCount: 3,
        failureCode: null,
      });
      expect(transport.attempts).toBe(3);
    });

    it('fails after three attempts that never answer, within the time budget; the trigger still succeeds', async () => {
      const ivy = await newUser('us5-life-hang', true);
      await optIn(ivy);
      transport.script = ['hang', 'hang', 'hang', 'hang'];
      const started = Date.now();
      await trigger(ivy); // 201: the write never fails on email
      expect(Date.now() - started).toBeLessThan(10_000);
      expect((await cashflowAlert(ivy)).emailDelivery).toMatchObject({
        status: 'FAILED',
        failureCode: 'TIMEOUT',
        sentAt: null,
      });
      expect(transport.attempts).toBeLessThanOrEqual(3);
    });

    it.each(['REJECTED', 'AUTH'] as const)(
      'does not retry %s; the alert stands',
      async (code) => {
        const user = await newUser(`us5-life-${code.toLowerCase()}`, true);
        await optIn(user);
        transport.script = [code];
        await trigger(user);
        const alert = await cashflowAlert(user);
        expect(alert).toMatchObject({ status: 'ACTIVE' });
        expect(alert.emailDelivery).toMatchObject({
          status: 'FAILED',
          attemptCount: 1,
          failureCode: code,
        });
        expect(transport.attempts).toBe(1);
      },
    );

    it('an interrupted PENDING delivery becomes FAILED/INTERRUPTED at the next read and is never resent', async () => {
      const jay = await newUser('us5-life-interrupted');
      const alert = await prisma.alert.create({
        data: {
          userId: jay.id,
          type: 'CASHFLOW_RISK',
          severity: 'CRITICAL',
          title: 'US5 interrupted',
          message: 'Evaluator-created before a crash',
          conditionKey: `cashflow:${jay.id}`,
          triggeredAt: new Date(NOW.getTime() - 5 * 60_000),
        },
      });
      await prisma.alertDelivery.create({
        data: {
          alertId: alert.id,
          userId: jay.id,
          provider: 'smtp',
          status: 'PENDING',
          attemptCount: 1,
          lastAttemptAt: new Date(NOW.getTime() - 32_001), // budget 2 s + 30 s margin
          createdAt: new Date(NOW.getTime() - 5 * 60_000),
        },
      });
      const [read] = await alertsWithKey(jay.agent, `cashflow:${jay.id}`);
      expect(read.emailDelivery).toMatchObject({
        status: 'FAILED',
        failureCode: 'INTERRUPTED',
        attemptCount: 1,
      });
      await trigger(jay);
      expect(transport.attempts).toBe(0);
    });

    it('the email states only that a critical alert of a named type exists, with the app link', async () => {
      const kim = await newUser('us5-life-privacy', true);
      await optIn(kim);
      await trigger(kim);
      expect(transport.sent).toHaveLength(1);
      const [message] = transport.sent;
      expect(message).toEqual({
        to: kim.email,
        subject: 'CashLens: new critical alert',
        text: [
          'You have a new critical CashLens alert: Cashflow risk.',
          '',
          'Open https://cashlens.example.test/app/alerts to see it.',
        ].join('\n'),
      });
    });
  });

  describe('concurrency (ALERT-002)', () => {
    it('concurrent evaluations leave exactly one open occurrence and one delivery', async () => {
      const lee = await newUser('us5-life-race', true);
      await optIn(lee);
      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          createTransaction(lee.agent, {
            amount: 1_000 + index,
            transactionTime: TODAY,
          }),
        ),
      );
      const rows = await alertsWithKey(lee.agent, `cashflow:${lee.id}`);
      expect(rows).toHaveLength(1);
      expect(transport.sent).toHaveLength(1);
    });

    it('the partial unique index turns a racing insert into a no-op, not an error', async () => {
      const mo = await newUser('us5-life-index');
      const repository = app.get(AlertsRepository);
      const insert = () =>
        prisma.$transaction((tx) =>
          repository.insertOccurrence(tx, {
            userId: mo.id,
            type: 'SYSTEM',
            severity: 'WARNING',
            title: 'US5 race',
            message: 'race',
            conditionKey: `sync-failure:race-${mo.id}`,
            triggeredAt: NOW,
          }),
        );
      const [first, second] = await Promise.all([insert(), insert()]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(
        await prisma.alert.count({
          where: { userId: mo.id, status: { in: ['ACTIVE', 'DISMISSED'] } },
        }),
      ).toBe(1);
    });
  });
});
