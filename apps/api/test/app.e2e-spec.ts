import { createTestApp } from './helpers/test-app'; // first: synthetic config before AppModule loads
import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  Agent,
  TestUser,
  cleanupUsers,
  promoteToAdminForTest,
  registerUser,
  syntheticPassword,
} from './helpers/auth-fixtures';

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
};

type UserResponse = {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  settings: {
    allowAiInsights: boolean;
    defaultMonthStartDay: number;
    notificationEnabled: boolean;
  };
};

type FinancialAccountResponse = {
  id: string;
  name: string;
  currentBalance: number | null;
  isDefault: boolean;
  status: string;
};

type TransactionCategoryResponse = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type TransactionResponse = {
  id: string;
  categoryId: string | null;
  financialAccountId: string | null;
  amount: number;
  direction: string;
  description: string | null;
  status: string;
  isDuplicate: boolean;
  duplicateOfTransactionId: string | null;
};

const bodyData = <T>(response: Response) =>
  (response.body as ApiResponse<T>).data;

// The ordinary user drives every self-service and owned-resource flow. Account
// administration and parser-template writes are administrator-only (SEC-002,
// SEC-003), so a controlled ADMIN - promoted by the harness in the shared test
// database, never through the API - performs them.
describe('CashLens current modules smoke test (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let agent: Agent;
  let admin: TestUser;

  const testRunId = Date.now();
  const email = `smoke-${testRunId}@example.com`;
  const managedUserEmail = `smoke-managed-${testRunId}@example.com`;
  const password = syntheticPassword();
  // Deterministic period (T036): the manual transactions share the user month
  // of the parsed fixture email (20/06/2026), so the monthly summary never
  // depends on the current date. 05:00Z is local midday in Asia/Ho_Chi_Minh,
  // so the UTC and local calendar dates agree.
  const transactionTime = '2026-06-15T05:00:00.000Z';
  const month = '2026-06';
  const date = '2026-06-15';

  let userId: string;
  let accountId: string;
  let categoryId: string;
  let incomeTransactionId: string;
  let expenseTransactionId: string;
  let listenRuleId: string;
  let bankProviderId: string;
  let emailConnectionId: string;
  let parsedEmailMessageId: string;
  let failedEmailMessageId: string;
  let parserTemplateId: string;
  let managedUserId: string | undefined;

  beforeAll(async () => {
    // Synthetic configuration and the production request pipeline (T010 harness).
    app = await createTestApp();
    prisma = app.get(PrismaService);
    agent = request.agent(app.getHttpServer());

    admin = await registerUser(app, 'smoke-admin');
    await promoteToAdminForTest(prisma, admin.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.parserTemplate.deleteMany({
        where: { name: { startsWith: 'VCB smoke parser ' } },
      });
      const users = await prisma.user.findMany({
        where: { email: { in: [email, managedUserEmail] } },
        select: { id: true },
      });
      await cleanupUsers(prisma, [
        ...users.map((user) => user.id),
        managedUserId,
        admin?.id,
      ]);
    }
    await app?.close();
  });

  describe('Auth and users', () => {
    it('rejects protected routes without cookies', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
      await request(app.getHttpServer())
        .get('/api/financial-accounts')
        .expect(401);
    });

    it('registers without creating a session', async () => {
      const response = await agent
        .post('/api/auth/register')
        .send({
          email,
          password,
          fullName: 'Smoke Test User',
          timezone: 'Asia/Ho_Chi_Minh',
          locale: 'vi-VN',
          baseCurrency: 'VND',
        })
        .expect(201);

      const user = bodyData<UserResponse>(response);
      userId = user.id;

      expect(user.email).toBe(email);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(user).not.toHaveProperty('accessToken');
      expect(user).not.toHaveProperty('refreshToken');

      await agent.get('/api/auth/me').expect(401);
    });

    it('logs in and authenticates with HttpOnly cookies', async () => {
      const response = await agent
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      const data = bodyData<{ user: UserResponse }>(response);
      const cookies = response.headers['set-cookie'] as unknown as string[];

      expect(data.user.id).toBe(userId);
      expect(data).not.toHaveProperty('accessToken');
      expect(data).not.toHaveProperty('refreshToken');
      expect(cookies).toHaveLength(2);
      expect(cookies.every((cookie) => cookie.includes('HttpOnly'))).toBe(true);
    });

    it('reads and updates the current user settings', async () => {
      const meResponse = await agent.get('/api/users/me').expect(200);
      expect(bodyData<UserResponse>(meResponse).id).toBe(userId);

      const settingsResponse = await agent
        .patch('/api/users/me/settings')
        .send({
          allowAiInsights: true,
          defaultMonthStartDay: 5,
          notificationEnabled: false,
        })
        .expect(200);

      expect(bodyData<UserResponse>(settingsResponse).settings).toMatchObject({
        allowAiInsights: true,
        defaultMonthStartDay: 5,
        notificationEnabled: false,
      });
    });

    it('lists and finds the registered user as an administrator only', async () => {
      const listQuery = { currentPage: 1, pageSize: 10, search: email };
      await agent.post('/api/users/list').send(listQuery).expect(403);
      await agent.get(`/api/users/${userId}`).expect(403);

      const listResponse = await admin.agent
        .post('/api/users/list')
        .send(listQuery)
        .expect(201);

      const list = bodyData<{ data: UserResponse[]; total: number }>(
        listResponse,
      );
      expect(list.total).toBeGreaterThanOrEqual(1);
      expect(list.data.some((user) => user.id === userId)).toBe(true);

      const findResponse = await admin.agent
        .get(`/api/users/${userId}`)
        .expect(200);
      expect(bodyData<UserResponse>(findResponse).email).toBe(email);
      // Administrators see identity and status, never private settings.
      expect(bodyData<UserResponse>(findResponse)).not.toHaveProperty(
        'settings',
      );
    });

    it('creates, updates, and deletes a managed user as an administrator only', async () => {
      const managedUserBody = {
        email: managedUserEmail,
        fullName: 'Managed Smoke User',
        timezone: 'UTC',
        locale: 'en-US',
        baseCurrency: 'USD',
      };
      await agent.post('/api/users').send(managedUserBody).expect(403);
      expect(
        await prisma.user.count({ where: { email: managedUserEmail } }),
      ).toBe(0);

      const createResponse = await admin.agent
        .post('/api/users')
        .send(managedUserBody)
        .expect(201);
      const managedUser = bodyData<UserResponse>(createResponse);
      managedUserId = managedUser.id;

      await agent
        .patch(`/api/users/${managedUser.id}`)
        .send({ status: 'DISABLED' })
        .expect(403);

      const updateResponse = await admin.agent
        .patch(`/api/users/${managedUser.id}`)
        .send({
          fullName: 'Managed Smoke User Updated',
          status: 'DISABLED',
        })
        .expect(200);
      expect(bodyData<UserResponse>(updateResponse)).toMatchObject({
        fullName: 'Managed Smoke User Updated',
        status: 'DISABLED',
      });

      await agent.delete(`/api/users/${managedUser.id}`).expect(403);
      const deleteResponse = await admin.agent
        .delete(`/api/users/${managedUser.id}`)
        .expect(200);
      expect(bodyData<{ id: string }>(deleteResponse).id).toBe(managedUser.id);
      await admin.agent.get(`/api/users/${managedUser.id}`).expect(404);
    });

    it('rotates cookies through refresh', async () => {
      const response = await agent.post('/api/auth/refresh').expect(200);
      const data = bodyData<{ user: UserResponse }>(response);

      expect(data.user.id).toBe(userId);
      expect(response.headers['set-cookie']).toHaveLength(2);
      expect(data).not.toHaveProperty('accessToken');
      expect(data).not.toHaveProperty('refreshToken');
    });
  });

  describe('Financial accounts', () => {
    it('creates, lists, reads, and updates an account', async () => {
      const createResponse = await agent
        .post('/api/financial-accounts')
        .send({
          name: 'Smoke Checking Account',
          institutionName: 'Smoke Bank',
          accountMask: '1234',
          type: 'BANK_ACCOUNT',
          currency: 'VND',
          openingBalance: 1000000,
          currentBalance: 1000000,
          isDefault: true,
        })
        .expect(201);

      const account = bodyData<FinancialAccountResponse>(createResponse);
      accountId = account.id;
      expect(account).toMatchObject({
        name: 'Smoke Checking Account',
        currentBalance: 1000000,
        isDefault: true,
        status: 'ACTIVE',
      });

      const listResponse = await agent
        .get('/api/financial-accounts')
        .query({ status: 'ACTIVE', type: 'BANK_ACCOUNT' })
        .expect(200);
      expect(
        bodyData<FinancialAccountResponse[]>(listResponse).some(
          (item) => item.id === accountId,
        ),
      ).toBe(true);

      const findResponse = await agent
        .get(`/api/financial-accounts/${accountId}`)
        .expect(200);
      expect(bodyData<FinancialAccountResponse>(findResponse).id).toBe(
        accountId,
      );

      const updateResponse = await agent
        .patch(`/api/financial-accounts/${accountId}`)
        .send({
          name: 'Smoke Primary Account',
          currentBalance: 1200000,
        })
        .expect(200);
      expect(bodyData<FinancialAccountResponse>(updateResponse)).toMatchObject({
        name: 'Smoke Primary Account',
        currentBalance: 1200000,
      });
    });
  });

  describe('Email integration foundation', () => {
    it('lists seeded bank providers', async () => {
      const response = await agent.get('/api/bank-providers').expect(200);
      const providers = bodyData<Array<{ id: string; code: string }>>(response);
      bankProviderId = providers.find(
        (provider) => provider.code === 'VCB',
      )!.id;

      expect(providers.map((provider) => provider.code)).toEqual(
        expect.arrayContaining(['VCB', 'TCB', 'MBB', 'ACB']),
      );
    });

    it('creates, lists, updates, and deletes a listen rule', async () => {
      const createResponse = await agent
        .post('/api/email-listen-rules')
        .send({
          name: 'Smoke Gmail Bank Rule',
          senderDomain: 'example-bank.vn',
          subjectContains: 'transaction',
          syncFromDate: new Date(Date.now() - 86400000).toISOString(),
          priority: 10,
        })
        .expect(201);
      const rule = bodyData<{ id: string; isEnabled: boolean }>(createResponse);
      listenRuleId = rule.id;
      expect(rule.isEnabled).toBe(true);

      const listResponse = await agent
        .get('/api/email-listen-rules')
        .expect(200);
      expect(
        bodyData<Array<{ id: string }>>(listResponse).some(
          (item) => item.id === listenRuleId,
        ),
      ).toBe(true);

      const updateResponse = await agent
        .patch(`/api/email-listen-rules/${listenRuleId}`)
        .send({ isEnabled: false, priority: 20 })
        .expect(200);
      expect(
        bodyData<{ isEnabled: boolean; priority: number }>(updateResponse),
      ).toMatchObject({ isEnabled: false, priority: 20 });

      const deleteResponse = await agent
        .delete(`/api/email-listen-rules/${listenRuleId}`)
        .expect(200);
      expect(bodyData<{ id: string }>(deleteResponse).id).toBe(listenRuleId);
    });

    it('creates a Gmail OAuth authorization URL with readonly scope', async () => {
      const response = await agent
        .post('/api/email-connections/gmail/connect')
        .expect(201);
      const { authorizationUrl } = bodyData<{ authorizationUrl: string }>(
        response,
      );
      const url = new URL(authorizationUrl);

      expect(url.origin).toBe('https://accounts.google.com');
      // The synthetic test configuration supplies the client id (T010 harness).
      expect(url.searchParams.get('client_id')).toBe(
        process.env.GMAIL_CLIENT_ID,
      );
      expect(url.searchParams.get('scope')).toBe(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
      expect(url.searchParams.get('state')).toBeTruthy();
    });

    it('prepares email metadata fixtures for deterministic parsing', async () => {
      const connection = await prisma.emailConnection.create({
        data: {
          userId,
          provider: 'GMAIL',
          emailAddress: email,
          accessTokenEncrypted: 'fixture-access-token',
          refreshTokenEncrypted: 'fixture-refresh-token',
          tokenExpiresAt: new Date(Date.now() + 3600000),
          scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        },
      });
      emailConnectionId = connection.id;

      const parsedMessage = await prisma.emailMessage.create({
        data: {
          userId,
          emailConnectionId,
          bankProviderId,
          providerMessageId: `gmail-success-${testRunId}`,
          senderEmail: 'notify@vcb.example.test',
          subject: 'VCB transaction notification',
          snippet:
            'Amount: 1,250,000 VND; Direction: EXPENSE; Time: 20/06/2026 15:30:00; Description: Grocery payment; Balance: 8,750,000 VND; Code: TXN123',
          receivedAt: new Date('2026-06-20T08:30:00.000Z'),
        },
      });
      parsedEmailMessageId = parsedMessage.id;

      const failedMessage = await prisma.emailMessage.create({
        data: {
          userId,
          emailConnectionId,
          bankProviderId,
          providerMessageId: `gmail-failed-${testRunId}`,
          senderEmail: 'notify@vcb.example.test',
          subject: 'VCB transaction notification',
          snippet: 'Direction: EXPENSE; Time: 20/06/2026 15:30:00',
          receivedAt: new Date('2026-06-20T08:30:00.000Z'),
        },
      });
      failedEmailMessageId = failedMessage.id;
    });
  });

  describe('Parser pipeline', () => {
    it('creates a safe versioned parser template as an administrator only', async () => {
      // Parser templates are global system configuration (SEC-003).
      await agent
        .post('/api/parser-templates')
        .send({
          bankProviderId,
          name: `VCB smoke parser ${testRunId} (refused)`,
          version: 1,
          channel: 'EMAIL',
        })
        .expect(403);

      const response = await admin.agent
        .post('/api/parser-templates')
        .send({
          bankProviderId,
          name: `VCB smoke parser ${testRunId}`,
          version: 1,
          channel: 'EMAIL',
          language: 'en',
          subjectPattern: 'VCB transaction',
          priority: 10,
          fields: [
            {
              fieldName: 'amount',
              fieldType: 'MONEY',
              regexPattern: 'Amount:\\s*([\\d,]+)',
              normalizer: 'vnd_money',
              isRequired: true,
            },
            {
              fieldName: 'direction',
              fieldType: 'DIRECTION',
              regexPattern: 'Direction:\\s*(\\w+)',
              isRequired: true,
            },
            {
              fieldName: 'transaction_time',
              fieldType: 'DATETIME',
              regexPattern:
                'Time:\\s*(\\d{2}/\\d{2}/\\d{4}\\s+\\d{2}:\\d{2}:\\d{2})',
              normalizer: 'vi_datetime',
              isRequired: true,
            },
            {
              fieldName: 'description',
              fieldType: 'TEXT',
              regexPattern: 'Description:\\s*([^;]+)',
            },
            {
              fieldName: 'balance_after',
              fieldType: 'MONEY',
              regexPattern: 'Balance:\\s*([\\d,]+)',
              normalizer: 'vnd_money',
            },
            {
              fieldName: 'transaction_code',
              fieldType: 'TEXT',
              regexPattern: 'Code:\\s*(\\w+)',
            },
          ],
        })
        .expect(201);
      parserTemplateId = bodyData<{ id: string }>(response).id;
      expect(parserTemplateId).toBeTruthy();

      const listResponse = await agent.get('/api/parser-templates').expect(200);
      expect(
        bodyData<Array<{ id: string }>>(listResponse).some(
          (template) => template.id === parserTemplateId,
        ),
      ).toBe(true);
    });

    it('parses an email into one idempotent transaction', async () => {
      const firstResponse = await agent
        .post(`/api/email-messages/${parsedEmailMessageId}/parse`)
        .expect(201);
      const first = bodyData<{ transactionId: string; created: boolean }>(
        firstResponse,
      );
      expect(first.created).toBe(true);

      const transaction = await prisma.transaction.findUniqueOrThrow({
        where: { id: first.transactionId },
      });
      expect(Number(transaction.amount)).toBe(1250000);
      expect(Number(transaction.balanceAfter)).toBe(8750000);
      expect(transaction.direction).toBe('EXPENSE');
      expect(transaction.sourceType).toBe('EMAIL');
      expect(transaction.emailMessageId).toBe(parsedEmailMessageId);
      expect(transaction.transactionCode).toBe('TXN123');

      const secondResponse = await agent
        .post(`/api/email-messages/${parsedEmailMessageId}/parse`)
        .expect(201);
      expect(
        bodyData<{ transactionId: string; created: boolean }>(secondResponse),
      ).toEqual({ transactionId: first.transactionId, created: false });

      expect(
        await prisma.transaction.count({
          where: { emailMessageId: parsedEmailMessageId },
        }),
      ).toBe(1);
    });

    it('records a failed parser run without creating a transaction', async () => {
      const response = await agent
        .post(`/api/email-messages/${failedEmailMessageId}/parse`)
        .expect(201);
      const result = bodyData<{
        created: boolean;
        parserRun: { status: string; errorMessage: string };
      }>(response);
      expect(result.created).toBe(false);
      expect(result.parserRun.status).toBe('FAILED');
      expect(result.parserRun.errorMessage).toContain('amount');

      expect(
        await prisma.transaction.count({
          where: { emailMessageId: failedEmailMessageId },
        }),
      ).toBe(0);
      expect(
        await prisma.emailMessage.findUniqueOrThrow({
          where: { id: failedEmailMessageId },
          select: { processingStatus: true },
        }),
      ).toEqual({ processingStatus: 'FAILED' });

      const runsResponse = await agent
        .get(`/api/email-messages/${failedEmailMessageId}/parser-runs`)
        .expect(200);
      expect(bodyData<Array<{ status: string }>>(runsResponse)[0].status).toBe(
        'FAILED',
      );
    });
  });

  describe('Transaction categories', () => {
    it('creates, lists, reads, and updates a category', async () => {
      const createResponse = await agent
        .post('/api/transaction-categories')
        .send({
          name: `Smoke Food ${testRunId}`,
          type: 'EXPENSE',
          icon: 'utensils',
          color: '#22c55e',
        })
        .expect(201);

      const category = bodyData<TransactionCategoryResponse>(createResponse);
      categoryId = category.id;
      expect(category.status).toBe('ACTIVE');

      const listResponse = await agent
        .get('/api/transaction-categories')
        .query({ type: 'EXPENSE', status: 'ACTIVE' })
        .expect(200);
      expect(
        bodyData<TransactionCategoryResponse[]>(listResponse).some(
          (item) => item.id === categoryId,
        ),
      ).toBe(true);

      const findResponse = await agent
        .get(`/api/transaction-categories/${categoryId}`)
        .expect(200);
      expect(bodyData<TransactionCategoryResponse>(findResponse).id).toBe(
        categoryId,
      );

      const updateResponse = await agent
        .patch(`/api/transaction-categories/${categoryId}`)
        .send({
          name: `Smoke Dining ${testRunId}`,
          color: '#16a34a',
          sortOrder: 10,
        })
        .expect(200);
      expect(bodyData<TransactionCategoryResponse>(updateResponse).name).toBe(
        `Smoke Dining ${testRunId}`,
      );
    });
  });

  describe('Transactions and analytics', () => {
    it('creates income and expense transactions', async () => {
      const incomeResponse = await agent
        .post('/api/transactions')
        .send({
          amount: 5000000,
          currency: 'VND',
          direction: 'INCOME',
          transactionTime,
          financialAccountId: accountId,
          description: 'Smoke salary',
        })
        .expect(201);
      incomeTransactionId = bodyData<TransactionResponse>(incomeResponse).id;

      const expenseResponse = await agent
        .post('/api/transactions')
        .send({
          amount: 200000,
          currency: 'VND',
          direction: 'EXPENSE',
          transactionTime,
          financialAccountId: accountId,
          categoryId,
          merchantName: 'Smoke Restaurant',
          description: 'Smoke dinner',
        })
        .expect(201);
      expenseTransactionId = bodyData<TransactionResponse>(expenseResponse).id;
    });

    it('lists, reads, updates, and categorizes transactions', async () => {
      const listResponse = await agent
        .get('/api/transactions')
        .query({
          financialAccountId: accountId,
          page: 1,
          limit: 20,
        })
        .expect(200);
      const list = bodyData<{
        data: TransactionResponse[];
        total: number;
      }>(listResponse);
      expect(list.total).toBe(2);

      const findResponse = await agent
        .get(`/api/transactions/${expenseTransactionId}`)
        .expect(200);
      expect(bodyData<TransactionResponse>(findResponse).amount).toBe(200000);

      const updateResponse = await agent
        .patch(`/api/transactions/${expenseTransactionId}`)
        .send({
          amount: 250000,
          description: 'Smoke dinner updated',
          userNote: 'QA update',
        })
        .expect(200);
      expect(bodyData<TransactionResponse>(updateResponse)).toMatchObject({
        amount: 250000,
        description: 'Smoke dinner updated',
      });

      const categoryResponse = await agent
        .patch(`/api/transactions/${incomeTransactionId}/category`)
        .send({ categoryId })
        .expect(200);
      expect(bodyData<TransactionResponse>(categoryResponse).categoryId).toBe(
        categoryId,
      );
    });

    it('returns monthly summary, category breakdown, and daily cashflow', async () => {
      const summaryResponse = await agent
        .get('/api/analytics/monthly-summary')
        .query({ month })
        .expect(200);
      const summary = bodyData<{
        income: number;
        expense: number;
        netCashflow: number;
        transactionCount: number;
      }>(summaryResponse);
      expect(summary).toMatchObject({
        income: 5000000,
        expense: 1500000,
        netCashflow: 3500000,
        transactionCount: 3,
      });

      const breakdownResponse = await agent
        .get('/api/analytics/category-breakdown')
        .query({ month })
        .expect(200);
      const breakdown =
        bodyData<
          Array<{ categoryId: string | null; amount: number; count: number }>
        >(breakdownResponse);
      expect(
        breakdown.some(
          (item) => item.categoryId === categoryId && item.count >= 1,
        ),
      ).toBe(true);

      const cashflowResponse = await agent
        .get('/api/analytics/cashflow')
        .query({ from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.999Z` })
        .expect(200);
      const cashflow = bodyData<
        Array<{
          date: string;
          currency: string;
          income: number;
          expense: number;
          netCashflow: number;
        }>
      >(cashflowResponse);
      expect(cashflow).toContainEqual({
        date,
        currency: 'VND',
        income: 5000000,
        expense: 250000,
        netCashflow: 4750000,
      });
    });

    it('marks duplicate, ignores, and soft-deletes transactions', async () => {
      const duplicateResponse = await agent
        .patch(`/api/transactions/${expenseTransactionId}/duplicate`)
        .send({ duplicateOfTransactionId: incomeTransactionId })
        .expect(200);
      expect(bodyData<TransactionResponse>(duplicateResponse)).toMatchObject({
        isDuplicate: true,
        duplicateOfTransactionId: incomeTransactionId,
      });

      const ignoreResponse = await agent
        .patch(`/api/transactions/${expenseTransactionId}/ignore`)
        .expect(200);
      expect(bodyData<TransactionResponse>(ignoreResponse).status).toBe(
        'IGNORED',
      );

      const deleteResponse = await agent
        .delete(`/api/transactions/${incomeTransactionId}`)
        .expect(200);
      expect(bodyData<{ id: string }>(deleteResponse).id).toBe(
        incomeTransactionId,
      );

      await agent.get(`/api/transactions/${incomeTransactionId}`).expect(404);
    });
  });

  describe('Archive and logout', () => {
    it('archives the category and financial account', async () => {
      const categoryResponse = await agent
        .delete(`/api/transaction-categories/${categoryId}`)
        .expect(200);
      expect(bodyData<{ id: string }>(categoryResponse).id).toBe(categoryId);
      const archivedCategory = await agent
        .get(`/api/transaction-categories/${categoryId}`)
        .expect(200);
      expect(
        bodyData<TransactionCategoryResponse>(archivedCategory).status,
      ).toBe('ARCHIVED');

      const accountResponse = await agent
        .delete(`/api/financial-accounts/${accountId}`)
        .expect(200);
      expect(bodyData<{ id: string }>(accountResponse).id).toBe(accountId);
      await agent.get(`/api/financial-accounts/${accountId}`).expect(404);
    });

    it('logs out, logs in again, and logs out all sessions', async () => {
      await agent.post('/api/auth/logout').expect(200);
      await agent.get('/api/auth/me').expect(401);

      await agent.post('/api/auth/login').send({ email, password }).expect(200);
      await agent.post('/api/auth/logout-all').expect(200);
      await agent.get('/api/auth/me').expect(401);
    });
  });
});
