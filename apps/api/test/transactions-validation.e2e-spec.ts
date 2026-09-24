import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  registerUser,
  syntheticEmail,
  syntheticPassword,
} from './helpers/auth-fixtures';
import { createTestApp } from './helpers/test-app';

jest.setTimeout(60_000);

type Row = {
  id: string;
  isDuplicate: boolean;
  duplicateOfTransactionId: string | null;
};

// T034 (TX-002, ERR-001): each invalid transaction field is refused with an
// actionable field error that names it (400), or with the owner-safe 404 for
// references the caller does not own; nothing is written either way.
describe('Transaction field and related-owner validation (T034)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let bob: TestUser;
  let aliceAccountId: string;
  let archivedAccountId: string;
  let archivedCategoryId: string;
  let aliceTransactionId: string;
  let bobAccountId: string;
  let bobCategoryId: string;
  let bobTransactionId: string;
  const extraUserIds: string[] = [];

  const valid = (extra: Record<string, unknown> = {}) => ({
    amount: 125000,
    currency: 'VND',
    direction: 'EXPENSE',
    transactionTime: '2026-06-15T12:00:00+07:00',
    description: 'T034 validation',
    ...extra,
  });

  const rowCount = () =>
    prisma.transaction.count({ where: { userId: alice.id } });

  /** 400 whose messages name every given field; no row is created. */
  const expectFieldError = async (
    call: () => request.Test,
    fields: string[],
  ) => {
    const before = await rowCount();
    const response = await call().expect(400);
    const messages = ([] as string[]).concat(
      (response.body as { message: string | string[] }).message,
    );
    for (const field of fields) {
      expect(messages.some((message) => message.includes(field))).toBe(true);
    }
    expect(await rowCount()).toBe(before);
    return messages;
  };

  const expectOwnerSafe404 = async (call: () => request.Test) => {
    const before = await rowCount();
    await call().expect(404);
    expect(await rowCount()).toBe(before);
  };

  const create = (body: Record<string, unknown>) => () =>
    alice.agent.post('/api/transactions').send(body);
  const patch = (id: string, body: Record<string, unknown>) => () =>
    alice.agent.patch(`/api/transactions/${id}`).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 't034-alice');
    bob = await registerUser(app, 't034-bob');

    const account = (agent: TestUser['agent'], name: string) =>
      agent
        .post('/api/financial-accounts')
        .send({ name: `${name} ${Date.now()}`, currency: 'VND' })
        .expect(201)
        .then((response) => dataOf<{ id: string }>(response).id);
    const category = (agent: TestUser['agent'], name: string) =>
      agent
        .post('/api/transaction-categories')
        .send({ name: `${name} ${Date.now()}` })
        .expect(201)
        .then((response) => dataOf<{ id: string }>(response).id);

    aliceAccountId = await account(alice.agent, 'T034 alice');
    archivedAccountId = await account(alice.agent, 'T034 archived');
    await alice.agent
      .delete(`/api/financial-accounts/${archivedAccountId}`)
      .expect(200);
    archivedCategoryId = await category(alice.agent, 'T034 archived');
    await alice.agent
      .delete(`/api/transaction-categories/${archivedCategoryId}`)
      .expect(200);
    bobAccountId = await account(bob.agent, 'T034 bob');
    bobCategoryId = await category(bob.agent, 'T034 bob');

    aliceTransactionId = dataOf<Row>(
      await alice.agent.post('/api/transactions').send(valid()).expect(201),
    ).id;
    bobTransactionId = dataOf<Row>(
      await bob.agent.post('/api/transactions').send(valid()).expect(201),
    ).id;
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupUsers(prisma, [alice?.id, bob?.id, ...extraUserIds]);
    }
    await app?.close();
  });

  describe('amount', () => {
    it.each([
      ['zero', 0],
      ['negative', -5000],
      ['three decimal places', 12.345],
      ['above the supported maximum', 10_000_000_000_000],
      ['not a number', 'abc'],
    ])('rejects an amount that is %s', async (_label, amount) => {
      await expectFieldError(create(valid({ amount })), ['amount']);
    });

    it('rejects a missing amount', async () => {
      const body: Record<string, unknown> = valid();
      delete body.amount;
      await expectFieldError(create(body), ['amount']);
    });

    it('accepts cents and the maximum amount', async () => {
      await create(valid({ amount: 12.34, currency: 'USD' }))().expect(201);
      await create(valid({ amount: 9_999_999_999_999.99 }))().expect(201);
    });

    it('rejects a negative fee', async () => {
      await expectFieldError(create(valid({ feeAmount: -1 })), ['feeAmount']);
    });
  });

  describe('currency and direction', () => {
    it.each([
      ['lower case', 'vnd'],
      ['two letters', 'VN'],
      ['not an ISO 4217 code', 'ABC'],
      ['not a string', 704],
    ])('rejects a currency that is %s', async (_label, currency) => {
      await expectFieldError(create(valid({ currency })), ['currency']);
    });

    it('rejects an unknown direction', async () => {
      await expectFieldError(create(valid({ direction: 'SPEND' })), [
        'direction',
      ]);
    });
  });

  describe('timestamps', () => {
    it.each([
      ['an impossible date', '2026-02-30T10:00:00Z'],
      ['no UTC offset', '2026-06-15T12:00:00'],
      ['a date without a time', '2026-06-15'],
      ['not a date', 'yesterday'],
    ])('rejects a transactionTime with %s', async (_label, transactionTime) => {
      await expectFieldError(create(valid({ transactionTime })), [
        'transactionTime',
      ]);
    });

    it('rejects a postedDate without a UTC offset', async () => {
      await expectFieldError(
        create(valid({ postedDate: '2026-06-16T09:00:00' })),
        ['postedDate'],
      );
    });

    it('rejects an invalid transactionTime on update too', async () => {
      await expectFieldError(
        patch(aliceTransactionId, { transactionTime: '2026-06-15T12:00:00' }),
        ['transactionTime'],
      );
    });
  });

  describe('related accounts and categories (owner-safe)', () => {
    it("refuses another user's account and category with 404", async () => {
      await expectOwnerSafe404(
        create(valid({ financialAccountId: bobAccountId })),
      );
      await expectOwnerSafe404(create(valid({ categoryId: bobCategoryId })));
      await expectOwnerSafe404(
        patch(aliceTransactionId, { financialAccountId: bobAccountId }),
      );
    });

    it('refuses an archived own account or category with the same 404', async () => {
      await expectOwnerSafe404(
        create(valid({ financialAccountId: archivedAccountId })),
      );
      await expectOwnerSafe404(
        create(valid({ categoryId: archivedCategoryId })),
      );
    });

    it('accepts an own active account', async () => {
      await create(valid({ financialAccountId: aliceAccountId }))().expect(201);
    });
  });

  describe('duplicate reference', () => {
    it('requires a reference when isDuplicate is true', async () => {
      await expectFieldError(create(valid({ isDuplicate: true })), [
        'duplicateOfTransactionId',
      ]);
    });

    it('rejects isDuplicate false together with a reference', async () => {
      await expectFieldError(
        create(
          valid({
            isDuplicate: false,
            duplicateOfTransactionId: aliceTransactionId,
          }),
        ),
        ['isDuplicate'],
      );
    });

    it('rejects a transaction referencing itself', async () => {
      await expectFieldError(
        patch(aliceTransactionId, {
          duplicateOfTransactionId: aliceTransactionId,
        }),
        ['duplicateOfTransactionId'],
      );
    });

    it("refuses another user's transaction as the reference with 404", async () => {
      await expectOwnerSafe404(
        create(valid({ duplicateOfTransactionId: bobTransactionId })),
      );
    });

    it('a reference alone marks the transaction as a duplicate; false clears it', async () => {
      const duplicate = dataOf<Row>(
        await create(
          valid({ duplicateOfTransactionId: aliceTransactionId }),
        )().expect(201),
      );
      expect(duplicate).toMatchObject({
        isDuplicate: true,
        duplicateOfTransactionId: aliceTransactionId,
      });
      const cleared = dataOf<Row>(
        await patch(duplicate.id, { isDuplicate: false })().expect(200),
      );
      expect(cleared).toMatchObject({
        isDuplicate: false,
        duplicateOfTransactionId: null,
      });
    });
  });

  describe('list filters', () => {
    const list = (query: Record<string, string>) => () =>
      alice.agent.get('/api/transactions').query(query);

    it.each([
      [{ from: '2026-06-01' }, 'from'],
      [{ to: '2026-06-30T23:59:59' }, 'to'],
      [{ month: '2026-13' }, 'month'],
      [{ month: '2026-6' }, 'month'],
      [{ search: 'x'.repeat(201) }, 'search'],
    ])('rejects %o', async (query, field) => {
      await expectFieldError(list(query), [field]);
    });

    it('rejects a from after to, and month combined with a range', async () => {
      await expectFieldError(
        list({ from: '2026-07-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }),
        ['from'],
      );
      await expectFieldError(
        list({ month: '2026-06', from: '2026-06-01T00:00:00Z' }),
        ['month'],
      );
    });
  });

  describe('dashboard and analytics periods', () => {
    it.each([
      '/api/dashboard/overview',
      '/api/dashboard/category-breakdown',
      '/api/dashboard/recent-transactions',
      '/api/dashboard/hot-budgets',
      '/api/dashboard/insights',
      '/api/dashboard/cashflow',
      '/api/analytics/monthly-summary',
      '/api/analytics/category-breakdown',
    ])('%s rejects a malformed month', async (path) => {
      for (const month of ['garbage', '2026-13', '2026-00']) {
        const response = await alice.agent
          .get(path)
          .query({ month })
          .expect(400);
        expect(JSON.stringify(response.body)).toContain('month');
      }
    });

    it('analytics cashflow rejects a range bound without a UTC offset', async () => {
      await expectFieldError(
        () =>
          alice.agent
            .get('/api/analytics/cashflow')
            .query({ from: '2026-06-01T00:00:00', to: '2026-06-30T00:00:00Z' }),
        ['from'],
      );
    });
  });

  describe('account period settings (DASH-002)', () => {
    it('refuses an unknown timezone or a lower-case base currency on the profile', async () => {
      await alice.agent
        .patch('/api/users/me')
        .send({ timezone: 'Mars/Olympus_Mons' })
        .expect(400);
      await alice.agent
        .patch('/api/users/me')
        .send({ baseCurrency: 'vnd' })
        .expect(400);
      const saved = await prisma.user.findUniqueOrThrow({
        where: { id: alice.id },
        select: { timezone: true, baseCurrency: true },
      });
      expect(saved).toEqual({
        timezone: 'Asia/Ho_Chi_Minh',
        baseCurrency: 'VND',
      });
    });

    it('refuses an unknown timezone at registration', async () => {
      const email = syntheticEmail('t034-register');
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email,
          password: syntheticPassword(),
          timezone: 'Nowhere/Land',
        })
        .expect(400);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });
  });

  // Added after the US2 review: each of these returned 500 or stored an
  // inconsistent row before.
  describe('review hardening', () => {
    it('rejects an amount written with an exponent instead of failing', async () => {
      const before = await rowCount();
      const response = await alice.agent
        .post('/api/transactions')
        .set('content-type', 'application/json')
        .send(JSON.stringify(valid({ amount: 1e-7 })))
        .expect(400);
      expect(JSON.stringify(response.body)).toContain('amount');
      expect(await rowCount()).toBe(before);
    });

    it('rejects null for fields every transaction carries', async () => {
      await expectFieldError(create(valid({ currency: null })), ['currency']);
      await expectFieldError(patch(aliceTransactionId, { amount: null }), [
        'amount',
      ]);
      await expectFieldError(
        patch(aliceTransactionId, { duplicateOfTransactionId: null }),
        ['duplicateOfTransactionId'],
      );
    });

    it('rejects month keys outside 1900-01..2099-12 on every period route', async () => {
      for (const month of ['9999-12', '0000-01', '0050-03', '2100-01']) {
        for (const path of [
          '/api/transactions',
          '/api/dashboard/overview',
          '/api/dashboard/cashflow',
          '/api/analytics/monthly-summary',
        ]) {
          const response = await alice.agent
            .get(path)
            .query({ month })
            .expect(400);
          expect(JSON.stringify(response.body)).toContain('month');
        }
      }
      await alice.agent
        .get('/api/dashboard/cashflow')
        .query({ month: '1900-01', months: 24 })
        .expect(200);
      await alice.agent
        .get('/api/dashboard/overview')
        .query({ month: '2099-12' })
        .expect(200);
    });

    it('rejects a page number that cannot be addressed', async () => {
      await expectFieldError(
        () =>
          alice.agent
            .get('/api/transactions')
            .query({ page: '1000000000000000000' }),
        ['page'],
      );
    });
  });
});
