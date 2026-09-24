import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import {
  FinancialAccount,
  Transaction,
  TransactionCategory,
} from '@prisma/client';
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
 * T014 [SEC-001, SEC-005, SEC-008, TEST-003, DATA-004]: two-user plus
 * administrator ownership matrix for finance core (financial accounts,
 * transactions, transaction categories).
 *
 * Policy under test (specs/001-operational-mvp, us1 test policy):
 * - missing or invalid authentication -> 401 on every route;
 * - another user's row -> the same owner-safe 404 as an absent id, for every
 *   read, update, delete and action route, and the row stays unchanged;
 * - administrators get no bypass (SEC-008): the same 404, own rows only;
 * - malformed ids -> 404, never 500; malformed or foreign related ids in
 *   bodies -> 400 or 404 and nothing is linked;
 * - system categories (userId NULL) are readable but not mutable (404);
 * - soft-deleted records stay out of normal views (DATA-004).
 *
 * Finance core has no role-gated route, so only the 401 and owner-safe 404
 * branches of "owner-safe 404 versus role-based 403" apply here.
 */

jest.setTimeout(30_000);

type Method = 'get' | 'post' | 'patch' | 'delete';
type Resource = 'account' | 'transaction' | 'category';
type CallerName = 'bob' | 'admin';

type IdRoute = {
  name: string;
  method: Method;
  resource: Resource;
  path: (id: string) => string;
  body?: (caller: CallerName) => object;
};

type Route = {
  name: string;
  method: Method;
  path: () => string;
  body?: () => object;
};

type LinkCase = {
  name: string;
  method: Method;
  path: (caller: CallerName) => string;
  body: () => object;
};

type BodyIdCase = {
  name: string;
  method: Method;
  path: () => string;
  body: (value: string) => object;
};

type AccountView = { id: string; userId: string };
type CategoryView = {
  id: string;
  userId: string | null;
  isSystem: boolean;
  status: string;
};
type TransactionView = {
  id: string;
  userId: string;
  financialAccountId: string | null;
  categoryId: string | null;
};
type TransactionPage = { data: TransactionView[]; total: number };

type OwnRows = {
  user: TestUser;
  accountId: string;
  categoryId: string;
  transactionId: string;
};

type AliceState = {
  account: FinancialAccount;
  category: TransactionCategory;
  transaction: Transaction;
};

let app: INestApplication<App>;
let prisma: PrismaService;
let alice: TestUser;
let aliceAccount: AccountView;
let aliceCategory: CategoryView;
let aliceTransaction: TransactionView;
let aliceSnapshot: AliceState;
let systemSnapshot: TransactionCategory | undefined;
const userIds: string[] = [];
const callers = {} as Record<CallerName, OwnRows>;
const aliceMarker = `alice-private-${RUN_ID}-${randomBytes(3).toString('hex')}`;

const CALLERS: Array<{ caller: CallerName; role: string }> = [
  { caller: 'bob', role: 'USER' },
  { caller: 'admin', role: 'ADMIN, no bypass' },
];

const unique = (prefix: string) =>
  `${prefix} ${RUN_ID} ${randomBytes(3).toString('hex')}`;

/** JWT-shaped random value, generated per call; never a real credential. */
const garbageToken = () =>
  [12, 24, 32].map((n) => randomBytes(n).toString('base64url')).join('.');

const idLabel = (id: string) =>
  id.length > 32 ? `${id.slice(0, 8)}...(${id.length} chars)` : `"${id}"`;

function call(
  client: Agent,
  method: Method,
  path: string,
  body?: object,
): request.Test {
  const pending = client[method](path);
  return body === undefined ? pending : pending.send(body);
}

/** Error body without per-request fields, for non-disclosure comparison. */
function errorBody(res: request.Response): Record<string, unknown> {
  const body = { ...(res.body as Record<string, unknown>) };
  delete body.timestamp;
  delete body.path;
  return body;
}

const transactionBody = (extra: Record<string, unknown> = {}) => ({
  amount: 125000,
  currency: 'VND',
  direction: 'EXPENSE',
  transactionTime: new Date().toISOString(),
  description: unique('e2e own-fin'),
  ...extra,
});

async function createAs<T>(
  agent: Agent,
  path: string,
  body: object,
): Promise<T> {
  const res = await agent.post(path).send(body).expect(201);
  return dataOf<T>(res);
}

const accountRow = (id: string) =>
  prisma.financialAccount.findUniqueOrThrow({ where: { id } });
const categoryRow = (id: string) =>
  prisma.transactionCategory.findUniqueOrThrow({ where: { id } });
const transactionRow = (id: string) =>
  prisma.transaction.findUniqueOrThrow({ where: { id } });

async function aliceState(): Promise<AliceState> {
  return {
    account: await accountRow(aliceAccount.id),
    category: await categoryRow(aliceCategory.id),
    transaction: await transactionRow(aliceTransaction.id),
  };
}

async function expectAliceRowsUnchanged(): Promise<void> {
  expect(await aliceState()).toEqual(aliceSnapshot);
}

/** Rows of anyone but alice that reference alice's account/category/transaction. */
async function foreignLinksToAlice(): Promise<number> {
  const transactions = await prisma.transaction.count({
    where: {
      userId: { not: alice.id },
      OR: [
        { financialAccountId: aliceAccount.id },
        { categoryId: aliceCategory.id },
        { duplicateOfTransactionId: aliceTransaction.id },
      ],
    },
  });
  const children = await prisma.transactionCategory.count({
    where: { parentId: aliceCategory.id },
  });
  return transactions + children;
}

async function ownState(name: CallerName) {
  const { user, accountId, categoryId, transactionId } = callers[name];
  return {
    account: await accountRow(accountId),
    category: await categoryRow(categoryId),
    transaction: await transactionRow(transactionId),
    accounts: await prisma.financialAccount.count({
      where: { userId: user.id },
    }),
    categories: await prisma.transactionCategory.count({
      where: { userId: user.id },
    }),
    transactions: await prisma.transaction.count({
      where: { userId: user.id },
    }),
  };
}

const aliceIdOf = (resource: Resource): string =>
  resource === 'account'
    ? aliceAccount.id
    : resource === 'transaction'
      ? aliceTransaction.id
      : aliceCategory.id;

const agentOf = (name: CallerName): Agent => callers[name].user.agent;

const accountPath = (id: string) => `/api/financial-accounts/${idPath(id)}`;
const transactionPath = (id: string, action = '') =>
  `/api/transactions/${idPath(id)}${action}`;
const categoryPath = (id: string) =>
  `/api/transaction-categories/${idPath(id)}`;

/** Every finance-core route that takes a resource id (read, update, delete, actions). */
const ID_ROUTES: IdRoute[] = [
  {
    name: 'GET /financial-accounts/:id',
    method: 'get',
    resource: 'account',
    path: accountPath,
  },
  {
    name: 'PATCH /financial-accounts/:id',
    method: 'patch',
    resource: 'account',
    path: accountPath,
    body: () => ({ name: unique('Hijacked account'), currentBalance: 1 }),
  },
  {
    name: 'PATCH /financial-accounts/:id (isDefault path)',
    method: 'patch',
    resource: 'account',
    path: accountPath,
    body: () => ({ name: unique('Hijacked default'), isDefault: true }),
  },
  {
    name: 'DELETE /financial-accounts/:id',
    method: 'delete',
    resource: 'account',
    path: accountPath,
  },
  {
    name: 'GET /transactions/:id',
    method: 'get',
    resource: 'transaction',
    path: (id) => transactionPath(id),
  },
  {
    name: 'PATCH /transactions/:id',
    method: 'patch',
    resource: 'transaction',
    path: (id) => transactionPath(id),
    body: () => ({ amount: 1, description: 'hijacked', userNote: 'hijacked' }),
  },
  {
    name: 'PATCH /transactions/:id/category',
    method: 'patch',
    resource: 'transaction',
    path: (id) => transactionPath(id, '/category'),
    body: () => ({ categoryId: systemSnapshot?.id }),
  },
  {
    name: 'PATCH /transactions/:id/duplicate',
    method: 'patch',
    resource: 'transaction',
    path: (id) => transactionPath(id, '/duplicate'),
    body: (caller) => ({
      duplicateOfTransactionId: callers[caller].transactionId,
    }),
  },
  {
    name: 'PATCH /transactions/:id/ignore',
    method: 'patch',
    resource: 'transaction',
    path: (id) => transactionPath(id, '/ignore'),
  },
  {
    name: 'DELETE /transactions/:id',
    method: 'delete',
    resource: 'transaction',
    path: (id) => transactionPath(id),
  },
  {
    name: 'GET /transaction-categories/:id',
    method: 'get',
    resource: 'category',
    path: categoryPath,
  },
  {
    name: 'PATCH /transaction-categories/:id',
    method: 'patch',
    resource: 'category',
    path: categoryPath,
    body: () => ({ name: unique('Hijacked category'), color: '#000000' }),
  },
  {
    name: 'DELETE /transaction-categories/:id',
    method: 'delete',
    resource: 'category',
    path: categoryPath,
  },
];

const COLLECTION_ROUTES: Route[] = [
  {
    name: 'GET /financial-accounts',
    method: 'get',
    path: () => '/api/financial-accounts',
  },
  {
    name: 'POST /financial-accounts',
    method: 'post',
    path: () => '/api/financial-accounts',
    body: () => ({ name: unique('Anonymous account') }),
  },
  { name: 'GET /transactions', method: 'get', path: () => '/api/transactions' },
  {
    name: 'POST /transactions',
    method: 'post',
    path: () => '/api/transactions',
    body: () => transactionBody(),
  },
  {
    name: 'GET /transaction-categories',
    method: 'get',
    path: () => '/api/transaction-categories',
  },
  {
    name: 'POST /transaction-categories',
    method: 'post',
    path: () => '/api/transaction-categories',
    body: () => ({ name: unique('Anonymous category') }),
  },
];

/** Every route, id routes aimed at alice's real rows. */
const ANONYMOUS_ROUTES: Route[] = [
  ...COLLECTION_ROUTES,
  ...ID_ROUTES.map((route) => ({
    name: route.name,
    method: route.method,
    path: () => route.path(aliceIdOf(route.resource)),
    body: route.body ? () => route.body?.('bob') ?? {} : undefined,
  })),
];

const CREDENTIALS: Array<[string, (pending: request.Test) => request.Test]> = [
  ['no credentials', (pending) => pending],
  [
    'garbage accessToken cookie',
    (pending) => pending.set('Cookie', `accessToken=${garbageToken()}`),
  ],
  [
    'garbage bearer token',
    (pending) => pending.set('Authorization', `Bearer ${garbageToken()}`),
  ],
];

/** Attempts to reference alice's rows from the caller's own records. */
const LINK_CASES: LinkCase[] = [
  {
    name: "POST /transactions with alice's financialAccountId",
    method: 'post',
    path: () => '/api/transactions',
    body: () => transactionBody({ financialAccountId: aliceAccount.id }),
  },
  {
    name: "POST /transactions with alice's categoryId",
    method: 'post',
    path: () => '/api/transactions',
    body: () => transactionBody({ categoryId: aliceCategory.id }),
  },
  {
    name: "POST /transactions with alice's transaction as duplicateOfTransactionId",
    method: 'post',
    path: () => '/api/transactions',
    body: () =>
      transactionBody({
        isDuplicate: true,
        duplicateOfTransactionId: aliceTransaction.id,
      }),
  },
  {
    name: "PATCH /transactions/:ownId with alice's financialAccountId",
    method: 'patch',
    path: (caller) => transactionPath(callers[caller].transactionId),
    body: () => ({ financialAccountId: aliceAccount.id }),
  },
  {
    name: "PATCH /transactions/:ownId with alice's categoryId",
    method: 'patch',
    path: (caller) => transactionPath(callers[caller].transactionId),
    body: () => ({ categoryId: aliceCategory.id }),
  },
  {
    name: "PATCH /transactions/:ownId with alice's transaction as duplicateOfTransactionId",
    method: 'patch',
    path: (caller) => transactionPath(callers[caller].transactionId),
    body: () => ({ duplicateOfTransactionId: aliceTransaction.id }),
  },
  {
    name: "PATCH /transactions/:ownId/category with alice's categoryId",
    method: 'patch',
    path: (caller) =>
      transactionPath(callers[caller].transactionId, '/category'),
    body: () => ({ categoryId: aliceCategory.id }),
  },
  {
    name: "PATCH /transactions/:ownId/duplicate with alice's transaction",
    method: 'patch',
    path: (caller) =>
      transactionPath(callers[caller].transactionId, '/duplicate'),
    body: () => ({ duplicateOfTransactionId: aliceTransaction.id }),
  },
  {
    name: "POST /transaction-categories with alice's category as parentId",
    method: 'post',
    path: () => '/api/transaction-categories',
    body: () => ({
      name: unique('Child of alice'),
      parentId: aliceCategory.id,
    }),
  },
  {
    name: "PATCH /transaction-categories/:ownId with alice's category as parentId",
    method: 'patch',
    path: (caller) => categoryPath(callers[caller].categoryId),
    body: () => ({ parentId: aliceCategory.id }),
  },
];

/** Related-id body fields, each exercised with '' and every malformed id. */
const BODY_ID_CASES: BodyIdCase[] = [
  {
    name: 'financialAccountId on POST /transactions',
    method: 'post',
    path: () => '/api/transactions',
    body: (value) => transactionBody({ financialAccountId: value }),
  },
  {
    name: 'categoryId on POST /transactions',
    method: 'post',
    path: () => '/api/transactions',
    body: (value) => transactionBody({ categoryId: value }),
  },
  {
    name: 'duplicateOfTransactionId on POST /transactions',
    method: 'post',
    path: () => '/api/transactions',
    body: (value) => transactionBody({ duplicateOfTransactionId: value }),
  },
  {
    name: 'financialAccountId on PATCH /transactions/:id',
    method: 'patch',
    path: () => transactionPath(callers.bob.transactionId),
    body: (value) => ({ financialAccountId: value }),
  },
  {
    name: 'categoryId on PATCH /transactions/:id',
    method: 'patch',
    path: () => transactionPath(callers.bob.transactionId),
    body: (value) => ({ categoryId: value }),
  },
  {
    name: 'duplicateOfTransactionId on PATCH /transactions/:id',
    method: 'patch',
    path: () => transactionPath(callers.bob.transactionId),
    body: (value) => ({ duplicateOfTransactionId: value }),
  },
  {
    name: 'categoryId on PATCH /transactions/:id/category',
    method: 'patch',
    path: () => transactionPath(callers.bob.transactionId, '/category'),
    body: (value) => ({ categoryId: value }),
  },
  {
    name: 'duplicateOfTransactionId on PATCH /transactions/:id/duplicate',
    method: 'patch',
    path: () => transactionPath(callers.bob.transactionId, '/duplicate'),
    body: (value) => ({ duplicateOfTransactionId: value }),
  },
  {
    name: 'parentId on POST /transaction-categories',
    method: 'post',
    path: () => '/api/transaction-categories',
    body: (value) => ({ name: unique('Malformed parent'), parentId: value }),
  },
  {
    name: 'parentId on PATCH /transaction-categories/:id',
    method: 'patch',
    path: () => categoryPath(callers.bob.categoryId),
    body: (value) => ({ parentId: value }),
  },
];

/** Attempts to choose the owner through the body or query (SEC-001). */
const OWNER_INJECTION_CASES: Route[] = [
  {
    name: 'POST /financial-accounts with body userId',
    method: 'post',
    path: () => '/api/financial-accounts',
    body: () => ({ name: unique('Injected account'), userId: alice.id }),
  },
  {
    name: 'POST /transactions with body userId',
    method: 'post',
    path: () => '/api/transactions',
    body: () => transactionBody({ userId: alice.id }),
  },
  {
    name: 'POST /transaction-categories with body userId',
    method: 'post',
    path: () => '/api/transaction-categories',
    body: () => ({ name: unique('Injected category'), userId: alice.id }),
  },
  {
    name: 'PATCH /financial-accounts/:ownId with body userId',
    method: 'patch',
    path: () => accountPath(callers.bob.accountId),
    body: () => ({ userId: alice.id }),
  },
  {
    name: 'PATCH /transactions/:ownId with body userId',
    method: 'patch',
    path: () => transactionPath(callers.bob.transactionId),
    body: () => ({ userId: alice.id }),
  },
  {
    name: 'PATCH /transaction-categories/:ownId with body userId',
    method: 'patch',
    path: () => categoryPath(callers.bob.categoryId),
    body: () => ({ userId: alice.id }),
  },
  {
    name: 'GET /financial-accounts?userId=<alice>',
    method: 'get',
    path: () =>
      `/api/financial-accounts?userId=${encodeURIComponent(alice.id)}`,
  },
  {
    name: 'GET /transactions?userId=<alice>',
    method: 'get',
    path: () => `/api/transactions?userId=${encodeURIComponent(alice.id)}`,
  },
  {
    name: 'GET /transaction-categories?userId=<alice>',
    method: 'get',
    path: () =>
      `/api/transaction-categories?userId=${encodeURIComponent(alice.id)}`,
  },
];

async function aliceCounts() {
  const where = { userId: alice.id };
  return {
    accounts: await prisma.financialAccount.count({ where }),
    categories: await prisma.transactionCategory.count({ where }),
    transactions: await prisma.transaction.count({ where }),
  };
}

const SYSTEM_CATEGORY_MUTATIONS: Array<{
  name: string;
  method: Method;
  body?: () => object;
}> = [
  {
    name: 'PATCH /transaction-categories/:systemId (rename)',
    method: 'patch',
    body: () => ({ name: unique('Hijacked system'), color: '#000000' }),
  },
  {
    name: 'PATCH /transaction-categories/:systemId (status ARCHIVED)',
    method: 'patch',
    body: () => ({ status: 'ARCHIVED' }),
  },
  { name: 'DELETE /transaction-categories/:systemId', method: 'delete' },
];

/** Restores the shared system category only if a regression changed it. */
async function restoreSystemCategory(): Promise<void> {
  if (!systemSnapshot) {
    return;
  }
  const current = await prisma.transactionCategory.findUnique({
    where: { id: systemSnapshot.id },
  });
  if (!current || JSON.stringify(current) === JSON.stringify(systemSnapshot)) {
    return;
  }
  const { name, slug, parentId, type, icon, color, sortOrder, status } =
    systemSnapshot;
  await prisma.transactionCategory.update({
    where: { id: systemSnapshot.id },
    data: {
      name,
      slug,
      parentId,
      type,
      icon,
      color,
      sortOrder,
      status,
      excludeFromBudget: systemSnapshot.excludeFromBudget,
      excludeFromAnalytics: systemSnapshot.excludeFromAnalytics,
    },
  });
}

describe('Finance core ownership matrix (T014)', () => {
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    alice = await registerUser(app, 'own-fin-alice');
    userIds.push(alice.id);
    const bob = await registerUser(app, 'own-fin-bob');
    userIds.push(bob.id);
    const admin = await registerUser(app, 'own-fin-admin');
    userIds.push(admin.id);

    await promoteToAdminForTest(prisma, admin.id);
    // A fresh session so the token, not only the stored row, carries ADMIN.
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);

    systemSnapshot = await prisma.transactionCategory.findFirstOrThrow({
      where: { userId: null, isSystem: true, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });

    aliceAccount = await createAs<AccountView>(
      alice.agent,
      '/api/financial-accounts',
      {
        name: unique('Alice checking'),
        type: 'CHECKING',
        currency: 'VND',
        openingBalance: 1000000,
        currentBalance: 1500000,
        isDefault: true,
      },
    );
    aliceCategory = await createAs<CategoryView>(
      alice.agent,
      '/api/transaction-categories',
      { name: unique('Alice groceries'), type: 'EXPENSE', color: '#123456' },
    );
    aliceTransaction = await createAs<TransactionView>(
      alice.agent,
      '/api/transactions',
      transactionBody({
        financialAccountId: aliceAccount.id,
        categoryId: aliceCategory.id,
        merchantName: 'Alice market',
        description: aliceMarker,
        userNote: 'alice private note',
      }),
    );

    for (const [name, user] of [
      ['bob', bob],
      ['admin', admin],
    ] as const) {
      const account = await createAs<AccountView>(
        user.agent,
        '/api/financial-accounts',
        { name: unique(`${name} wallet`), type: 'E_WALLET', currency: 'VND' },
      );
      const category = await createAs<CategoryView>(
        user.agent,
        '/api/transaction-categories',
        { name: unique(`${name} hobbies`), type: 'EXPENSE' },
      );
      const transaction = await createAs<TransactionView>(
        user.agent,
        '/api/transactions',
        transactionBody({
          financialAccountId: account.id,
          categoryId: category.id,
        }),
      );
      callers[name] = {
        user,
        accountId: account.id,
        categoryId: category.id,
        transactionId: transaction.id,
      };
    }

    aliceSnapshot = await aliceState();
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await restoreSystemCategory();
      await cleanupUsers(prisma, userIds);
    }
    await app?.close();
  }, 60_000);

  describe('setup sanity (positive controls)', () => {
    it('alice (owner) reads her own account, transaction and category with 200', async () => {
      const outcomes = [
        await alice.agent.get(accountPath(aliceAccount.id)),
        await alice.agent.get(transactionPath(aliceTransaction.id)),
        await alice.agent.get(categoryPath(aliceCategory.id)),
      ].map((res) => [res.status, dataOf<{ id: string }>(res)?.id]);
      expect(outcomes).toEqual([
        [200, aliceAccount.id],
        [200, aliceTransaction.id],
        [200, aliceCategory.id],
      ]);
    });

    it('the admin caller holds the persisted ADMIN role in its session', async () => {
      const me = await agentOf('admin').get('/api/auth/me').expect(200);
      expect(dataOf<{ role: string }>(me).role).toBe('ADMIN');
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: callers.admin.user.id },
      });
      expect(stored.role).toBe('ADMIN');
    });

    it.each(CALLERS)(
      '$caller linked its own account and category into its own transaction',
      async ({ caller }) => {
        const own = callers[caller];
        const row = await transactionRow(own.transactionId);
        expect({
          userId: row.userId,
          financialAccountId: row.financialAccountId,
          categoryId: row.categoryId,
        }).toEqual({
          userId: own.user.id,
          financialAccountId: own.accountId,
          categoryId: own.categoryId,
        });
      },
    );
  });

  describe('unauthenticated access', () => {
    it.each(ANONYMOUS_ROUTES)(
      'unauthenticated caller gets 401 on $name',
      async (route) => {
        const outcomes: Array<[string, number]> = [];
        for (const [label, attach] of CREDENTIALS) {
          const anonymous = request.agent(app.getHttpServer());
          const res = await attach(
            call(anonymous, route.method, route.path(), route.body?.()),
          );
          outcomes.push([label, res.status]);
        }
        expect(outcomes).toEqual(CREDENTIALS.map(([label]) => [label, 401]));
        await expectAliceRowsUnchanged();
      },
    );
  });

  describe.each(CALLERS)(
    "cross-user access to alice's rows as $caller ($role)",
    ({ caller }) => {
      it.each(ID_ROUTES)(
        "gets the owner-safe 404 on $name for alice's row, identical to an absent id, and her rows stay unchanged",
        async (route) => {
          const agent = agentOf(caller);
          const foreign = await call(
            agent,
            route.method,
            route.path(aliceIdOf(route.resource)),
            route.body?.(caller),
          );
          const absent = await call(
            agent,
            route.method,
            route.path(absentId()),
            route.body?.(caller),
          );
          expect(absent.status).toBe(404);
          expect({
            status: foreign.status,
            body: errorBody(foreign),
          }).toEqual({ status: 404, body: errorBody(absent) });
          await expectAliceRowsUnchanged();
        },
      );
    },
  );

  describe.each(CALLERS)('list endpoints as $caller ($role)', ({ caller }) => {
    it("GET /financial-accounts lists only the caller's own accounts", async () => {
      const me = callers[caller];
      const queries = [
        '',
        '?status=ACTIVE',
        '?type=CHECKING',
        '?type=E_WALLET',
      ];
      const outcomes: Array<{
        query: string;
        status: number;
        foreign: string[];
      }> = [];
      for (const query of queries) {
        const res = await me.user.agent.get(`/api/financial-accounts${query}`);
        const rows = res.status === 200 ? dataOf<AccountView[]>(res) : [];
        outcomes.push({
          query,
          status: res.status,
          foreign: rows
            .filter((row) => row.userId !== me.user.id)
            .map((row) => row.id),
        });
      }
      expect(outcomes).toEqual(
        queries.map((query) => ({ query, status: 200, foreign: [] })),
      );
      const all = await me.user.agent.get('/api/financial-accounts');
      const ids = dataOf<AccountView[]>(all).map((row) => row.id);
      expect(ids).toContain(me.accountId);
      expect(ids).not.toContain(aliceAccount.id);
    });

    it("GET /transactions lists only the caller's own transactions", async () => {
      const me = callers[caller];
      const queries = [
        '',
        '?limit=100',
        '?status=POSTED',
        '?direction=EXPENSE',
        `?search=${aliceMarker}`,
      ];
      const outcomes: Array<{
        query: string;
        status: number;
        foreign: string[];
      }> = [];
      for (const query of queries) {
        const res = await me.user.agent.get(`/api/transactions${query}`);
        const rows =
          res.status === 200 ? dataOf<TransactionPage>(res).data : [];
        outcomes.push({
          query,
          status: res.status,
          foreign: rows
            .filter((row) => row.userId !== me.user.id)
            .map((row) => row.id),
        });
      }
      expect(outcomes).toEqual(
        queries.map((query) => ({ query, status: 200, foreign: [] })),
      );
      const all = await me.user.agent.get('/api/transactions?limit=100');
      const ids = dataOf<TransactionPage>(all).data.map((row) => row.id);
      expect(ids).toContain(me.transactionId);
      expect(ids).not.toContain(aliceTransaction.id);
    });

    it("GET /transactions filtered by alice's account or category id discloses none of her rows", async () => {
      const me = callers[caller];
      const queries = [
        `?financialAccountId=${encodeURIComponent(aliceAccount.id)}`,
        `?categoryId=${encodeURIComponent(aliceCategory.id)}`,
      ];
      const outcomes: Array<{ query: string; outcome: string }> = [];
      for (const query of queries) {
        const res = await me.user.agent.get(`/api/transactions${query}`);
        let outcome = `unexpected ${res.status}`;
        if (res.status === 200) {
          const page = dataOf<TransactionPage>(res);
          outcome =
            page.total === 0 && page.data.length === 0
              ? 'nothing disclosed'
              : `disclosed ${page.total} row(s)`;
        } else if (res.status === 400 || res.status === 404) {
          outcome = 'nothing disclosed';
        }
        outcomes.push({ query, outcome });
      }
      expect(outcomes).toEqual(
        queries.map((query) => ({ query, outcome: 'nothing disclosed' })),
      );
    });

    it("GET /transaction-categories lists system categories and the caller's own only", async () => {
      const me = callers[caller];
      const queries = [
        '',
        '?type=EXPENSE',
        '?status=ACTIVE',
        '?status=ARCHIVED',
      ];
      const outcomes: Array<{
        query: string;
        status: number;
        foreign: string[];
      }> = [];
      for (const query of queries) {
        const res = await me.user.agent.get(
          `/api/transaction-categories${query}`,
        );
        const rows = res.status === 200 ? dataOf<CategoryView[]>(res) : [];
        outcomes.push({
          query,
          status: res.status,
          foreign: rows
            .filter((row) => row.userId !== null && row.userId !== me.user.id)
            .map((row) => row.id),
        });
      }
      expect(outcomes).toEqual(
        queries.map((query) => ({ query, status: 200, foreign: [] })),
      );
      const all = await me.user.agent.get('/api/transaction-categories');
      const ids = dataOf<CategoryView[]>(all).map((row) => row.id);
      expect(ids).toEqual(
        expect.arrayContaining([me.categoryId, systemSnapshot?.id]),
      );
      expect(ids).not.toContain(aliceCategory.id);
    });
  });

  describe('malformed and absent ids', () => {
    it.each(ID_ROUTES)(
      'bob gets 404 (never 500) on $name for every malformed or absent id',
      async (route) => {
        const ids = [...MALFORMED_IDS, absentId()];
        const outcomes: Array<[string, number]> = [];
        for (const id of ids) {
          const res = await call(
            agentOf('bob'),
            route.method,
            route.path(id),
            route.body?.('bob'),
          );
          outcomes.push([idLabel(id), res.status]);
        }
        expect(outcomes).toEqual(ids.map((id) => [idLabel(id), 404]));
      },
    );
  });

  describe.each(CALLERS)(
    "linking alice's rows into own records as $caller ($role)",
    ({ caller }) => {
      it.each(LINK_CASES)(
        'is refused with 400 or 404 and nothing is linked or changed: $name',
        async (link) => {
          const before = await ownState(caller);
          const res = await call(
            agentOf(caller),
            link.method,
            link.path(caller),
            link.body(),
          );
          expect([400, 404]).toContain(res.status);
          expect(await ownState(caller)).toEqual(before);
          expect(await foreignLinksToAlice()).toBe(0);
          await expectAliceRowsUnchanged();
        },
      );
    },
  );

  describe('owner injection through body or query (SEC-001)', () => {
    it.each(OWNER_INJECTION_CASES)(
      'bob gets 400 for $name and no row changes owner',
      async (injection) => {
        const bobBefore = await ownState('bob');
        const aliceBefore = await aliceCounts();
        const res = await call(
          agentOf('bob'),
          injection.method,
          injection.path(),
          injection.body?.(),
        );
        expect(res.status).toBe(400);
        expect(await ownState('bob')).toEqual(bobBefore);
        expect(await aliceCounts()).toEqual(aliceBefore);
        await expectAliceRowsUnchanged();
      },
    );
  });

  describe('malformed related ids in request bodies (SEC-007)', () => {
    it.each(BODY_ID_CASES)(
      'bob gets 400 or 404 (never 500) for an empty or malformed $name, and nothing changes',
      async (bodyCase) => {
        const values = ['', ...MALFORMED_IDS];
        const before = await ownState('bob');
        const outcomes: Array<[string, string]> = [];
        for (const value of values) {
          const res = await call(
            agentOf('bob'),
            bodyCase.method,
            bodyCase.path(),
            bodyCase.body(value),
          );
          outcomes.push([
            idLabel(value),
            res.status === 400 || res.status === 404
              ? 'refused'
              : `unexpected ${res.status}`,
          ]);
        }
        expect(outcomes).toEqual(
          values.map((value) => [idLabel(value), 'refused']),
        );
        expect(await ownState('bob')).toEqual(before);
      },
    );
  });

  describe.each(CALLERS)(
    'system categories as $caller ($role)',
    ({ caller }) => {
      it('reads a system category with 200 on GET /transaction-categories/:systemId', async () => {
        const id = systemSnapshot?.id ?? '';
        const res = await agentOf(caller).get(categoryPath(id)).expect(200);
        expect(dataOf<CategoryView>(res)).toMatchObject({
          id,
          userId: null,
          isSystem: true,
        });
      });

      it.each(SYSTEM_CATEGORY_MUTATIONS)(
        'gets 404 on $name and the system category is unchanged',
        async (mutation) => {
          const id = systemSnapshot?.id ?? '';
          const res = await call(
            agentOf(caller),
            mutation.method,
            categoryPath(id),
            mutation.body?.(),
          );
          expect(res.status).toBe(404);
          expect(await categoryRow(id)).toEqual(systemSnapshot);
        },
      );
    },
  );

  describe('soft-deleted records (DATA-004)', () => {
    const deletedMarker = `alice-deleted-${RUN_ID}-${randomBytes(3).toString('hex')}`;
    let deletedTransaction: TransactionView;
    let archivedAccount: AccountView;

    const listedTransactionIds = (res: request.Response) =>
      res.status === 200
        ? dataOf<TransactionPage>(res).data.map((row) => row.id)
        : [];

    beforeAll(async () => {
      deletedTransaction = await createAs<TransactionView>(
        alice.agent,
        '/api/transactions',
        transactionBody({ description: deletedMarker }),
      );
      await alice.agent
        .delete(transactionPath(deletedTransaction.id))
        .expect(200);

      archivedAccount = await createAs<AccountView>(
        alice.agent,
        '/api/financial-accounts',
        { name: unique('Alice closed savings'), type: 'SAVINGS' },
      );
      await alice.agent.delete(accountPath(archivedAccount.id)).expect(200);
    });

    it('DELETE /transactions/:id is a soft delete and the owner then gets 404 on GET /transactions/:id', async () => {
      const row = await transactionRow(deletedTransaction.id);
      expect(row.status).toBe('DELETED');
      await alice.agent.get(transactionPath(deletedTransaction.id)).expect(404);
    });

    it("the owner's soft-deleted transaction is excluded from GET /transactions (default and search)", async () => {
      const outcomes: Array<{
        query: string;
        status: number;
        listed: boolean;
      }> = [];
      for (const query of ['?limit=100', `?search=${deletedMarker}`]) {
        const res = await alice.agent.get(`/api/transactions${query}`);
        outcomes.push({
          query,
          status: res.status,
          listed: listedTransactionIds(res).includes(deletedTransaction.id),
        });
      }
      expect(outcomes).toEqual([
        { query: '?limit=100', status: 200, listed: false },
        { query: `?search=${deletedMarker}`, status: 200, listed: false },
      ]);
    });

    it("the owner's soft-deleted transaction is not listed by GET /transactions?status=DELETED (400 or excluded)", async () => {
      const res = await alice.agent.get('/api/transactions?status=DELETED');
      expect([200, 400]).toContain(res.status);
      expect(listedTransactionIds(res)).not.toContain(deletedTransaction.id);
    });

    it.each(CALLERS)(
      "$caller cannot see alice's soft-deleted transaction (GET /:id and ?status=DELETED)",
      async ({ caller }) => {
        const agent = agentOf(caller);
        const detail = await agent.get(transactionPath(deletedTransaction.id));
        const list = await agent.get('/api/transactions?status=DELETED');
        expect(detail.status).toBe(404);
        expect([200, 400]).toContain(list.status);
        expect(listedTransactionIds(list)).not.toContain(deletedTransaction.id);
      },
    );

    it('an archived financial account is excluded from lists (default and ?status=ARCHIVED) and GET /financial-accounts/:id', async () => {
      const row = await accountRow(archivedAccount.id);
      expect(row.deletedAt).not.toBeNull();
      const outcomes: Array<{
        query: string;
        status: number;
        listed: boolean;
      }> = [];
      for (const query of ['', '?status=ARCHIVED']) {
        const res = await alice.agent.get(`/api/financial-accounts${query}`);
        const rows = res.status === 200 ? dataOf<AccountView[]>(res) : [];
        outcomes.push({
          query,
          status: res.status,
          listed: rows.some((account) => account.id === archivedAccount.id),
        });
      }
      expect(outcomes).toEqual([
        { query: '', status: 200, listed: false },
        { query: '?status=ARCHIVED', status: 200, listed: false },
      ]);
      await alice.agent.get(accountPath(archivedAccount.id)).expect(404);
    });

    it('an archived financial account cannot be linked into a new transaction', async () => {
      const where = { userId: alice.id };
      const before = await prisma.transaction.count({ where });
      const res = await alice.agent
        .post('/api/transactions')
        .send(transactionBody({ financialAccountId: archivedAccount.id }));
      expect([400, 404]).toContain(res.status);
      expect(await prisma.transaction.count({ where })).toBe(before);
    });
  });
});
