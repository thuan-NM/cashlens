import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import {
  EmailImportHarness,
  HOUR,
  MutableClock,
  alertsOf,
  alertsWithKey,
  createAlertTestApp,
  createTransaction,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T086 (SC-007, ALERT-009 large-transaction row): manual and imported
 * transactions, under a controlled clock.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');
const at = (local: string) => `${local}+07:00`;
const THIS_MONTH = at('2026-09-15T10:00:00');

describe('Large-transaction alerts (T086)', () => {
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
  const key = (id: string) => `large-tx:${id}`;
  const statuses = async (user: TestUser, id: string) =>
    (await alertsWithKey(user.agent, key(id))).map((alert) => alert.status);
  const expense = (user: TestUser, amount: number, extra = {}) =>
    createTransaction(user.agent, {
      amount,
      transactionTime: THIS_MONTH,
      ...extra,
    });

  beforeAll(async () => {
    app = await createAlertTestApp({ clock });
    prisma = app.get(PrismaService);
    alice = await newUser('us5-large-alice');
  });

  beforeEach(() => clock.set(NOW));

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

  it('opens a WARNING at exactly the 5,000,000 VND default, keyed by the transaction', async () => {
    const id = await expense(alice, 5_000_000);
    const [alert] = await alertsWithKey(alice.agent, key(id));
    expect(alert).toMatchObject({
      type: 'LARGE_TRANSACTION',
      severity: 'WARNING',
      status: 'ACTIVE',
      resourceType: 'transaction',
      resourceId: id,
      thresholdValue: 5_000_000,
      observedValue: 5_000_000,
      triggeredAt: NOW.toISOString(),
      emailDelivery: expect.objectContaining({
        status: 'SKIPPED',
        // No transport in this app (EMAIL_TRANSPORT=disabled).
        skipReason: 'TRANSPORT_DISABLED',
      }) as object,
    });
  });

  it('does not open below the threshold', async () => {
    const id = await expense(alice, 4_999_999);
    expect(await alertsWithKey(alice.agent, key(id))).toEqual([]);
  });

  it.each([
    ['INCOME', { direction: 'INCOME' }],
    ['TRANSFER_OUT', { direction: 'TRANSFER_OUT' }],
    ['another currency', { currency: 'USD' }],
    ['last month', { transactionTime: at('2026-08-31T23:00:00') }],
  ])('never opens for %s', async (_label, extra) => {
    const id = await expense(alice, 9_000_000, extra);
    expect(await alertsWithKey(alice.agent, key(id))).toEqual([]);
  });

  it('resolves when the amount drops below the threshold, and a re-raise within 24h is not stored', async () => {
    const id = await expense(alice, 6_000_000);
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ amount: 100_000 })
      .expect(200);
    expect(await alertsWithKey(alice.agent, key(id))).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'BELOW_THRESHOLD',
      }),
    ]);
    clock.advance(HOUR);
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ amount: 6_000_000 })
      .expect(200);
    expect(await statuses(alice, id)).toEqual(['RESOLVED']);
    clock.set(new Date(NOW.getTime() + 24 * HOUR));
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}`)
      .send({ amount: 6_500_000 })
      .expect(200);
    expect(await statuses(alice, id)).toEqual(['RESOLVED', 'ACTIVE']);
  });

  it.each([
    [
      'deleted',
      (id: string) => alice.agent.delete(`/api/transactions/${idPath(id)}`),
    ],
    [
      'ignored',
      (id: string) =>
        alice.agent.patch(`/api/transactions/${idPath(id)}/ignore`),
    ],
    [
      'made non-expense',
      (id: string) =>
        alice.agent
          .patch(`/api/transactions/${idPath(id)}`)
          .send({ direction: 'INCOME' }),
    ],
  ])('resolves when the transaction is %s', async (_label, mutate) => {
    const id = await expense(alice, 7_000_000);
    expect(await statuses(alice, id)).toEqual(['ACTIVE']);
    await mutate(id).expect(200);
    expect(await statuses(alice, id)).toEqual(['RESOLVED']);
  });

  it('resolves when the transaction is marked a duplicate', async () => {
    const original = await expense(alice, 10_000);
    const id = await expense(alice, 7_000_000);
    await alice.agent
      .patch(`/api/transactions/${idPath(id)}/duplicate`)
      .send({ duplicateOfTransactionId: original })
      .expect(200);
    expect(await alertsWithKey(alice.agent, key(id))).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'TARGET_REMOVED',
      }),
    ]);
  });

  it('applies the user threshold to new transactions and never re-evaluates existing ones when it changes', async () => {
    const bob = await newUser('us5-large-threshold');
    await bob.agent
      .patch('/api/alerts/settings')
      .send({ type: 'LARGE_TRANSACTION', threshold: 2_000_000 })
      .expect(200);
    const first = await expense(bob, 2_500_000);
    expect(await statuses(bob, first)).toEqual(['ACTIVE']);

    await bob.agent
      .patch('/api/alerts/settings')
      .send({ type: 'LARGE_TRANSACTION', threshold: 10_000_000 })
      .expect(200);
    // Edits that do not touch amount, currency, direction, or eligibility
    // do not re-evaluate it; nor does another transaction.
    await bob.agent
      .patch(`/api/transactions/${idPath(first)}`)
      .send({ description: 'renamed' })
      .expect(200);
    await expense(bob, 1_000);
    expect(await statuses(bob, first)).toEqual(['ACTIVE']);

    const second = await expense(bob, 2_500_000);
    expect(await alertsWithKey(bob.agent, key(second))).toEqual([]);
  });

  it('is inactive for a non-VND base currency until the user sets a threshold', async () => {
    const carol = await newUser('us5-large-usd');
    await carol.agent
      .patch('/api/users/me')
      .send({ baseCurrency: 'USD' })
      .expect(200);
    const unset = await expense(carol, 1_000_000_000, { currency: 'USD' });
    expect(await alertsWithKey(carol.agent, key(unset))).toEqual([]);

    await carol.agent
      .patch('/api/alerts/settings')
      .send({ type: 'LARGE_TRANSACTION', threshold: 300 })
      .expect(200);
    const set = await expense(carol, 300, { currency: 'USD' });
    expect(await statuses(carol, set)).toEqual(['ACTIVE']);
  });

  it('opens nothing while in-app is off for the type, but still resolves an open one', async () => {
    const dave = await newUser('us5-large-inapp');
    const open = await expense(dave, 8_000_000);
    await dave.agent
      .patch('/api/alerts/settings')
      .send({ type: 'LARGE_TRANSACTION', inAppEnabled: false })
      .expect(200);
    const muted = await expense(dave, 8_000_000);
    expect(await alertsWithKey(dave.agent, key(muted))).toEqual([]);
    await dave.agent.delete(`/api/transactions/${idPath(open)}`).expect(200);
    expect(await statuses(dave, open)).toEqual(['RESOLVED']);
  });

  it('an imported expense alerts exactly like a manual one, once per batch', async () => {
    const importer = await newUser('us5-large-import');
    const created = await EmailImportHarness.create(app, importer, 'us5l');
    harness = created.harness;
    users.push(created.admin);

    const big = harness.queue({
      amount: 6_000_000,
      time: '15/09/2026 10:00:00',
    });
    const small = harness.queue({
      amount: 100_000,
      time: '15/09/2026 11:00:00',
    });
    const old = harness.queue({
      amount: 9_000_000,
      time: '15/08/2026 10:00:00',
    });
    expect(await harness.sync()).toMatchObject({
      status: 'SUCCESS',
      transactionsCreated: 3,
    });

    const bigTx = await harness.importedTransaction(big);
    const smallTx = await harness.importedTransaction(small);
    const oldTx = await harness.importedTransaction(old);
    const manualId = await expense(importer, 6_000_000);

    const [imported] = await alertsWithKey(importer.agent, key(bigTx.id));
    const [manual] = await alertsWithKey(importer.agent, key(manualId));
    expect(imported).toMatchObject({
      status: 'ACTIVE',
      thresholdValue: 5_000_000,
      observedValue: 6_000_000,
    });
    expect({
      ...imported,
      id: '',
      resourceId: '',
      conditionKey: '',
      metadata: null,
      createdAt: '',
    }).toEqual({
      ...manual,
      id: '',
      resourceId: '',
      conditionKey: '',
      metadata: null,
      createdAt: '',
    });
    expect(await alertsWithKey(importer.agent, key(smallTx.id))).toEqual([]);
    expect(await alertsWithKey(importer.agent, key(oldTx.id))).toEqual([]);

    // Replaying the mailbox imports nothing new and alerts nothing new.
    const before = (await alertsOf(importer.agent)).length;
    expect(await harness.sync()).toMatchObject({ transactionsCreated: 0 });
    expect(await alertsOf(importer.agent)).toHaveLength(before);
  });
});
