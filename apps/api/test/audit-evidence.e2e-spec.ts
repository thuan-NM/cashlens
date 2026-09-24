import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { GmailApiService } from '../src/modules/email-ingestion/gmail-api.service';
import { GmailOAuthService } from '../src/modules/email-connections/gmail-oauth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  promoteToAdminForTest,
  registerUser,
  syntheticEmail,
} from './helpers/auth-fixtures';
import { createTestApp } from './helpers/test-app';

jest.setTimeout(60_000);

type AuditRow = {
  userId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
};

// T029 (SEC-006, AUTH-005): each sensitive action leaves sanitized audit
// evidence - actor, action, resource - and never a credential, token, cookie,
// mailbox address, or email content.
describe('Sanitized audit evidence (T029)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let admin: TestUser;
  const extraUserIds: string[] = [];
  const secrets: string[] = [];

  const lastAudit = async (action: string, resourceId: string) => {
    const row = await prisma.auditLog.findFirst({
      where: { action, resourceId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new Error(`No ${action} audit row for the resource.`);
    return row as AuditRow;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 't029-alice');
    admin = await registerUser(app, 't029-admin');
    await promoteToAdminForTest(prisma, admin.id);
    secrets.push(alice.password, admin.password);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupUsers(prisma, [alice?.id, admin?.id, ...extraUserIds]);
    }
    await app?.close();
  });

  it('privileged account changes by an administrator are recorded as ADMIN actions', async () => {
    const created = await admin.agent
      .post('/api/users')
      .send({ email: syntheticEmail('t029-managed'), fullName: 'Managed' })
      .expect(201);
    const managedId = dataOf<{ id: string }>(created).id;
    extraUserIds.push(managedId);

    await admin.agent
      .patch(`/api/users/${managedId}`)
      .send({ fullName: 'Renamed', status: 'DISABLED' })
      .expect(200);
    await admin.agent.delete(`/api/users/${managedId}`).expect(200);

    const createdRow = await lastAudit('ADMIN_USER_CREATED', managedId);
    const updatedRow = await lastAudit('ADMIN_USER_UPDATED', managedId);
    const deletedRow = await lastAudit('ADMIN_USER_DELETED', managedId);
    for (const row of [createdRow, updatedRow, deletedRow]) {
      expect(row).toMatchObject({
        userId: admin.id,
        actorType: 'ADMIN',
        resourceType: 'user',
      });
    }
    expect(updatedRow.metadata).toEqual({
      fields: ['fullName', 'status'],
      status: 'DISABLED',
    });
  });

  it('self-service profile and settings changes record field names only', async () => {
    await alice.agent
      .patch('/api/users/me')
      .send({ fullName: 'Alice Audit' })
      .expect(200);
    await alice.agent
      .patch('/api/users/me/settings')
      .send({ notificationEnabled: false, defaultMonthStartDay: 5 })
      .expect(200);

    expect(await lastAudit('USER_PROFILE_UPDATED', alice.id)).toMatchObject({
      userId: alice.id,
      actorType: 'USER',
      resourceType: 'user',
      metadata: { fields: ['fullName'] },
    });
    expect(await lastAudit('USER_SETTINGS_UPDATED', alice.id)).toMatchObject({
      userId: alice.id,
      actorType: 'USER',
      metadata: { fields: ['defaultMonthStartDay', 'notificationEnabled'] },
    });
  });

  it('category corrections and destructive financial actions are recorded', async () => {
    const category = dataOf<{ id: string }>(
      await alice.agent
        .post('/api/transaction-categories')
        .send({ name: `T029 ${randomBytes(3).toString('hex')}` })
        .expect(201),
    );
    const account = dataOf<{ id: string }>(
      await alice.agent
        .post('/api/financial-accounts')
        .send({ name: `T029 wallet ${randomBytes(3).toString('hex')}` })
        .expect(201),
    );
    const transaction = dataOf<{ id: string }>(
      await alice.agent
        .post('/api/transactions')
        .send({
          amount: 125000,
          direction: 'EXPENSE',
          transactionTime: new Date().toISOString(),
        })
        .expect(201),
    );

    await alice.agent
      .patch(`/api/transactions/${transaction.id}/category`)
      .send({ categoryId: category.id })
      .expect(200);
    await alice.agent.delete(`/api/transactions/${transaction.id}`).expect(200);
    await alice.agent
      .delete(`/api/financial-accounts/${account.id}`)
      .expect(200);
    await alice.agent
      .delete(`/api/transaction-categories/${category.id}`)
      .expect(200);

    expect(
      await lastAudit('TRANSACTION_CATEGORY_CORRECTED', transaction.id),
    ).toMatchObject({
      userId: alice.id,
      actorType: 'USER',
      resourceType: 'transaction',
      metadata: { fromCategoryId: null, toCategoryId: category.id },
    });
    expect(
      await lastAudit('TRANSACTION_DELETED', transaction.id),
    ).toMatchObject({ userId: alice.id, resourceType: 'transaction' });
    expect(
      await lastAudit('FINANCIAL_ACCOUNT_ARCHIVED', account.id),
    ).toMatchObject({ userId: alice.id, resourceType: 'financial_account' });
    expect(
      await lastAudit('TRANSACTION_CATEGORY_ARCHIVED', category.id),
    ).toMatchObject({ userId: alice.id, resourceType: 'transaction_category' });
  });

  it('email connect, sync, and disconnect are recorded without mailbox, token, or content', async () => {
    const gmailOAuth = app.get(GmailOAuthService);
    const gmailApi = app.get(GmailApiService);
    const accessToken = randomBytes(24).toString('base64url');
    const refreshToken = randomBytes(24).toString('base64url');
    const mailbox = syntheticEmail('t029-mailbox');
    secrets.push(accessToken, refreshToken, mailbox);
    const exchange = jest.spyOn(gmailOAuth, 'exchangeCode').mockResolvedValue({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      token_type: 'Bearer',
    });
    const profile = jest.spyOn(gmailOAuth, 'profile').mockResolvedValue({
      emailAddress: mailbox,
      messagesTotal: 0,
      threadsTotal: 0,
      historyId: '1',
    });
    const list = jest
      .spyOn(gmailApi, 'listMessageIds')
      .mockResolvedValue({ ids: [] });

    try {
      const connect = await alice.agent
        .post('/api/email-connections/gmail/connect')
        .expect(201);
      const state = new URL(
        dataOf<{ authorizationUrl: string }>(connect).authorizationUrl,
      ).searchParams.get('state');
      await alice.agent
        .get('/api/email-connections/gmail/callback')
        .query({ state, code: randomBytes(16).toString('base64url') })
        .expect(200);
      const connection = await prisma.emailConnection.findFirstOrThrow({
        where: { userId: alice.id, emailAddress: mailbox },
      });

      await alice.agent
        .post('/api/email-listen-rules')
        .send({ name: 'T029 rule', emailConnectionId: connection.id })
        .expect(201);
      await alice.agent
        .post(`/api/email-connections/${connection.id}/sync`)
        .expect(201);
      await alice.agent
        .delete(`/api/email-connections/${connection.id}`)
        .expect(200);

      expect(await lastAudit('EMAIL_CONNECTED', connection.id)).toMatchObject({
        userId: alice.id,
        actorType: 'USER',
        resourceType: 'email_connection',
        metadata: { provider: 'GMAIL' },
      });
      const sync = await lastAudit('EMAIL_SYNC', connection.id);
      expect(sync).toMatchObject({
        userId: alice.id,
        resourceType: 'email_connection',
      });
      expect(sync.metadata).toMatchObject({
        status: 'SUCCESS',
        emailsFound: 0,
        transactionsCreated: 0,
      });
      expect(
        await lastAudit('EMAIL_DISCONNECTED', connection.id),
      ).toMatchObject({ userId: alice.id, resourceType: 'email_connection' });
    } finally {
      exchange.mockRestore();
      profile.mockRestore();
      list.mockRestore();
    }
  });

  it('no audit row of these accounts contains a password, token, cookie, or mailbox address', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { userId: { in: [alice.id, admin.id] } },
    });
    expect(rows.length).toBeGreaterThan(10);
    const serialized = JSON.stringify(rows);
    for (const secret of secrets) {
      expect(serialized.includes(secret)).toBe(false);
    }
    expect(serialized).not.toMatch(
      /accessToken|refreshToken|passwordHash|cookie/i,
    );
    // A raw access or refresh cookie from a signed-in agent never appears either.
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: alice.email, password: alice.password })
      .expect(200);
    const cookieValues = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .map((cookie) => cookie.split(';')[0].split('=')[1])
      .filter(Boolean);
    const after = JSON.stringify(
      await prisma.auditLog.findMany({ where: { userId: alice.id } }),
    );
    for (const value of cookieValues) {
      expect(after.includes(value)).toBe(false);
    }
  });
});
