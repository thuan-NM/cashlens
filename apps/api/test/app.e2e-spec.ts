import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request, { Response, SuperAgentTest } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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

describe('CashLens current modules smoke test (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let agent: SuperAgentTest;

  const testRunId = Date.now();
  const email = `smoke-${testRunId}@example.com`;
  const managedUserEmail = `smoke-managed-${testRunId}@example.com`;
  const password = 'CashLens123!';
  const transactionTime = new Date().toISOString();
  const month = transactionTime.slice(0, 7);
  const date = transactionTime.slice(0, 10);

  let userId: string;
  let accountId: string;
  let categoryId: string;
  let incomeTransactionId: string;
  let expenseTransactionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [email, managedUserEmail] } },
    });
    await app.close();
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

    it('lists and finds the registered user', async () => {
      const listResponse = await agent
        .post('/api/users/list')
        .send({
          currentPage: 1,
          pageSize: 10,
          search: email,
        })
        .expect(201);

      const list = bodyData<{ data: UserResponse[]; total: number }>(
        listResponse,
      );
      expect(list.total).toBeGreaterThanOrEqual(1);
      expect(list.data.some((user) => user.id === userId)).toBe(true);

      const findResponse = await agent.get(`/api/users/${userId}`).expect(200);
      expect(bodyData<UserResponse>(findResponse).email).toBe(email);
    });

    it('creates, updates, and deletes a managed user', async () => {
      const createResponse = await agent
        .post('/api/users')
        .send({
          email: managedUserEmail,
          fullName: 'Managed Smoke User',
          timezone: 'UTC',
          locale: 'en-US',
          baseCurrency: 'USD',
        })
        .expect(201);
      const managedUser = bodyData<UserResponse>(createResponse);

      const updateResponse = await agent
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

      const deleteResponse = await agent
        .delete(`/api/users/${managedUser.id}`)
        .expect(200);
      expect(bodyData<{ id: string }>(deleteResponse).id).toBe(managedUser.id);
      await agent.get(`/api/users/${managedUser.id}`).expect(404);
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

      const category =
        bodyData<TransactionCategoryResponse>(createResponse);
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
      incomeTransactionId =
        bodyData<TransactionResponse>(incomeResponse).id;

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
      expenseTransactionId =
        bodyData<TransactionResponse>(expenseResponse).id;
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
        expense: 250000,
        netCashflow: 4750000,
        transactionCount: 2,
      });

      const breakdownResponse = await agent
        .get('/api/analytics/category-breakdown')
        .query({ month })
        .expect(200);
      const breakdown = bodyData<
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
          income: number;
          expense: number;
          netCashflow: number;
        }>
      >(cashflowResponse);
      expect(cashflow).toContainEqual({
        date,
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

      await agent
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      await agent.post('/api/auth/logout-all').expect(200);
      await agent.get('/api/auth/me').expect(401);
    });
  });
});
