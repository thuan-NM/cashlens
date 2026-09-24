import { createTestApp } from './helpers/test-app'; // must stay first: seeds synthetic env
import {
  RUN_ID,
  TestUser,
  absentId,
  cleanupUsers,
  dataOf,
  idPath,
  promoteToAdminForTest,
  registerUser,
  syntheticEmail,
  syntheticPassword,
} from './helpers/auth-fixtures';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * T011 [SEC-002, SEC-003, SEC-004, SEC-005, SEC-007, SC-015]
 * Role checks and privileged-field protection.
 *
 * Expected policy (specs/001-operational-mvp): admin-only routes answer 403 to
 * an ordinary USER and 401 without a session; role and status are read from
 * the database on every request; public and self-service bodies cannot bind
 * role, status, ownership, or classification provenance (400); no network
 * path can write bank providers (404: there is no write route).
 */

jest.setTimeout(30_000);

type UserView = Record<string, unknown> & {
  id: string;
  email: string;
  role: string;
  status: string;
};
type TemplateView = { id: string; name: string; priority: number };

// Account identity/status fields an administrator may see (contract:
// "non-financial account fields").
const ADMIN_VISIBLE_USER_FIELDS = [
  'id',
  'email',
  'fullName',
  'role',
  'status',
  'timezone',
  'locale',
  'baseCurrency',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
];

const snapshot = (row: unknown): unknown =>
  JSON.parse(JSON.stringify(row)) as unknown;

const unique = () => `${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;

// The 400 must name the privileged field, so it cannot come from some other
// validation problem in the body.
const namesField = (field: string) => (response: request.Response) => {
  expect(JSON.stringify(response.body)).toMatch(new RegExp(`\\b${field}\\b`));
};

describe('Admin authorization and privileged fields (T011)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let user: TestUser;
  let other: TestUser;
  let admin: TestUser;
  let target: TestUser;
  let bankProviderId: string;
  let fixtureTemplateId: string;
  const extraUserIds: string[] = [];
  const attemptedEmails: string[] = [];
  const baselineIds: Record<string, string> = {};
  const templatePrefix = `t011-${RUN_ID}-`;

  const anon = () => request(app.getHttpServer());

  const templateBody = (label: string) => ({
    bankProviderId,
    name: `${templatePrefix}${label}`,
    version: 1,
    isActive: false, // never selected for parsing by concurrent suites
    priority: 999,
    subjectPattern: '^T011 synthetic subject that never matches$',
    fields: [
      {
        fieldName: 'amount',
        fieldType: 'MONEY',
        regexPattern: '(\\d+)',
        regexGroupIndex: 1,
      },
    ],
  });

  const registerExtra = async (label: string): Promise<TestUser> => {
    const created = await registerUser(app, label);
    extraUserIds.push(created.id);
    return created;
  };

  const storedUser = (id: string) =>
    prisma.user.findUniqueOrThrow({ where: { id } });

  // POST /users/list answers 201 on success today (Nest's POST default). The
  // policy under test is authorization, so 200 or 201 both mean "allowed".
  const listUsers = (agent: TestUser['agent']) =>
    agent.post('/api/users/list').send({ currentPage: 1, pageSize: 5 });
  const expectAllowed = (response: request.Response) =>
    expect([200, 201]).toContain(response.status);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    user = await registerUser(app, 't011-user');
    other = await registerUser(app, 't011-other');
    admin = await registerUser(app, 't011-admin');
    target = await registerUser(app, 't011-target');
    await promoteToAdminForTest(prisma, admin.id);

    const provider = await prisma.bankProvider.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    bankProviderId = provider.id;

    const fixture = await prisma.parserTemplate.create({
      data: {
        bankProviderId,
        name: `${templatePrefix}fixture`,
        version: 1,
        isActive: false,
        priority: 999,
        subjectPattern: '^T011 synthetic subject that never matches$',
        fields: {
          create: [
            {
              fieldName: 'amount',
              fieldType: 'MONEY',
              regexPattern: '(\\d+)',
              regexGroupIndex: 1,
            },
          ],
        },
      },
    });
    fixtureTemplateId = fixture.id;
  }, 60_000);

  // Today's code lets a USER change role/status; restore the shared users so
  // one test's outcome cannot leak into the next.
  afterEach(async () => {
    const ids = [user?.id, other?.id].filter((id): id is string => Boolean(id));
    if (ids.length) {
      await prisma.user.updateMany({
        where: { id: { in: ids } },
        data: { role: 'USER', status: 'ACTIVE', deletedAt: null },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.parserTemplate.deleteMany({
        where: { name: { startsWith: templatePrefix } },
      });
      const attempted = attemptedEmails.length
        ? await prisma.user.findMany({
            where: { email: { in: attemptedEmails } },
            select: { id: true },
          })
        : [];
      await cleanupUsers(prisma, [
        user?.id,
        other?.id,
        admin?.id,
        target?.id,
        ...extraUserIds,
        ...attempted.map((row) => row.id),
      ]);
    }
    await app?.close();
  }, 60_000);

  describe('account administration routes (/api/users)', () => {
    const adminRoutes: Array<[string, string, () => string]> = [
      ['post', 'list', () => '/api/users/list'],
      ['post', 'create', () => '/api/users'],
      ['get', 'read', () => `/api/users/${idPath(target.id)}`],
      ['patch', 'update', () => `/api/users/${idPath(target.id)}`],
      ['delete', 'delete', () => `/api/users/${idPath(target.id)}`],
    ];

    it.each(adminRoutes)(
      'unauthenticated gets 401 on %s /users (%s)',
      async (method, _label, path) => {
        const server = anon();
        const call =
          method === 'post'
            ? server.post(path())
            : method === 'get'
              ? server.get(path())
              : method === 'patch'
                ? server.patch(path())
                : server.delete(path());
        await call.send({ role: 'ADMIN' }).expect(401);
        const stored = await storedUser(target.id);
        expect(stored.role).toBe('USER');
        expect(stored.deletedAt).toBeNull();
      },
    );

    it('USER gets 403 on PATCH /users/:ownId with role ADMIN and the stored role stays USER', async () => {
      await user.agent
        .patch(`/api/users/${idPath(user.id)}`)
        .send({ role: 'ADMIN' })
        .expect(403);
      expect((await storedUser(user.id)).role).toBe('USER');
    });

    it.each(['DISABLED', 'PENDING_DELETE'])(
      'USER gets 403 on PATCH /users/:ownId with status %s and the stored status stays ACTIVE',
      async (status) => {
        await user.agent
          .patch(`/api/users/${idPath(user.id)}`)
          .send({ status })
          .expect(403);
        const stored = await storedUser(user.id);
        expect(stored.status).toBe('ACTIVE');
        expect(stored.role).toBe('USER');
      },
    );

    it("USER gets 403 on PATCH /users/:id granting ADMIN to another account and that account's role stays USER", async () => {
      await user.agent
        .patch(`/api/users/${idPath(other.id)}`)
        .send({ role: 'ADMIN', status: 'ACTIVE' })
        .expect(403);
      expect((await storedUser(other.id)).role).toBe('USER');
    });

    it('USER gets 403 on PATCH /users/:id for an absent id (role check precedes lookup)', async () => {
      await user.agent
        .patch(`/api/users/${idPath(absentId())}`)
        .send({ role: 'ADMIN' })
        .expect(403);
    });

    it.each([
      ['GET', 'get'],
      ['DELETE', 'delete'],
    ] as const)(
      'USER gets 403 on %s /users/:id for an absent id',
      async (_label, method) => {
        const path = `/api/users/${idPath(absentId())}`;
        await (
          method === 'get' ? user.agent.get(path) : user.agent.delete(path)
        ).expect(403);
      },
    );

    it('USER gets 403 on POST /users with role ADMIN and no account is created', async () => {
      const email = syntheticEmail('t011-user-created-admin');
      attemptedEmails.push(email);
      await user.agent
        .post('/api/users')
        .send({ email, fullName: 'E2E self-made admin', role: 'ADMIN' })
        .expect(403);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('USER gets 403 on POST /users without role and no account is created', async () => {
      const email = syntheticEmail('t011-user-created-plain');
      attemptedEmails.push(email);
      await user.agent
        .post('/api/users')
        .send({ email, fullName: 'E2E user-created account' })
        .expect(403);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('USER gets 403 on POST /users/list', async () => {
      await listUsers(user.agent).expect(403);
    });
  });

  describe('public registration (POST /api/auth/register)', () => {
    it.each([
      ['role', () => 'ADMIN'],
      ['status', () => 'ACTIVE'],
      ['userId', () => other.id],
    ] as Array<[string, () => unknown]>)(
      'registration with %s gets 400 and no account is created',
      async (field, value) => {
        const email = syntheticEmail(`t011-register-${field}`);
        attemptedEmails.push(email);
        await anon()
          .post('/api/auth/register')
          .send({
            email,
            password: syntheticPassword(),
            fullName: 'E2E privileged register',
            [field]: value(),
          })
          .expect(400)
          .expect(namesField(field));
        expect(await prisma.user.count({ where: { email } })).toBe(0);
      },
    );
  });

  describe('self-service privileged fields', () => {
    it.each([
      ['role', () => 'ADMIN'],
      ['status', () => 'DISABLED'],
      ['userId', () => other.id],
    ] as Array<[string, () => unknown]>)(
      'PATCH /users/me/settings with %s gets 400 and nothing changes',
      async (field, value) => {
        const settingsOf = async (userId: string) =>
          snapshot(await prisma.userSettings.findUnique({ where: { userId } }));
        const mySettings = await prisma.userSettings.findUnique({
          where: { userId: user.id },
        });
        const before = {
          mine: snapshot(mySettings),
          theirs: await settingsOf(other.id),
          account: snapshot(await storedUser(user.id)),
        };
        await user.agent
          .patch('/api/users/me/settings')
          .send({
            notificationEnabled: !(mySettings?.notificationEnabled ?? true),
            [field]: value(),
          })
          .expect(400)
          .expect(namesField(field));
        expect({
          mine: await settingsOf(user.id),
          theirs: await settingsOf(other.id),
          account: snapshot(await storedUser(user.id)),
        }).toEqual(before);
      },
    );

    it.each([
      ['role', () => 'ADMIN'],
      ['status', () => 'DISABLED'],
      ['userId', () => other.id],
      ['id', () => other.id],
      ['email', () => syntheticEmail('t011-me-email')],
      ['deletedAt', () => new Date().toISOString()],
    ] as Array<[string, () => unknown]>)(
      'PATCH /users/me (self-service profile) with %s gets 400 and the account is unchanged',
      async (field, value) => {
        const before = snapshot(await storedUser(user.id));
        await user.agent
          .patch('/api/users/me')
          .send({
            fullName: 'E2E renamed by privileged body',
            [field]: value(),
          })
          .expect(400)
          .expect(namesField(field));
        expect(snapshot(await storedUser(user.id))).toEqual(before);
      },
    );
  });

  describe('owned-resource privileged fields (mass assignment)', () => {
    type OwnedResource = {
      route: string;
      body: () => Record<string, unknown>;
      privileged: Array<[label: string, field: string, value: () => unknown]>;
      count: (userId: string) => Promise<number>;
      find: (id: string) => Promise<unknown>;
    };

    const resources: OwnedResource[] = [
      {
        route: 'transactions',
        body: () => ({
          amount: 125000,
          direction: 'EXPENSE',
          transactionTime: new Date().toISOString(),
          description: `T011 synthetic ${unique()}`,
        }),
        privileged: [
          ['userId', 'userId', () => other.id],
          ['classificationSource', 'classificationSource', () => 'SYSTEM'],
          [
            'classificationSource: USER_RULE',
            'classificationSource',
            () => 'USER_RULE',
          ],
          ['classificationConfidence', 'classificationConfidence', () => 0.99],
          ['classificationRuleId', 'classificationRuleId', () => 'rule-x'],
          ['classifiedAt', 'classifiedAt', () => new Date().toISOString()],
          ['sourceType', 'sourceType', () => 'EMAIL'],
        ],
        count: (userId) => prisma.transaction.count({ where: { userId } }),
        find: (id) => prisma.transaction.findUnique({ where: { id } }),
      },
      {
        route: 'financial-accounts',
        body: () => ({ name: `T011 account ${unique()}` }),
        privileged: [
          ['userId', 'userId', () => other.id],
          ['deletedAt', 'deletedAt', () => new Date().toISOString()],
          ['lastSyncedAt', 'lastSyncedAt', () => new Date().toISOString()],
        ],
        count: (userId) => prisma.financialAccount.count({ where: { userId } }),
        find: (id) => prisma.financialAccount.findUnique({ where: { id } }),
      },
      {
        route: 'transaction-categories',
        body: () => ({ name: `T011 category ${unique()}` }),
        privileged: [
          ['userId', 'userId', () => other.id],
          ['userId: null (global category)', 'userId', () => null],
          ['isSystem', 'isSystem', () => true],
        ],
        count: (userId) =>
          prisma.transactionCategory.count({ where: { userId } }),
        find: (id) => prisma.transactionCategory.findUnique({ where: { id } }),
      },
      {
        // A system rule has no owner: userId null must never be accepted.
        route: 'classification-rules',
        body: () => ({
          categoryId: 'sys_cat_expense_food',
          descriptionPattern: `T011 rule ${unique()}`,
        }),
        privileged: [
          ['userId', 'userId', () => other.id],
          ['userId: null (system rule)', 'userId', () => null],
          ['scope', 'scope', () => 'SYSTEM'],
        ],
        count: (userId) => prisma.merchantRule.count({ where: { userId } }),
        find: (id) => prisma.merchantRule.findUnique({ where: { id } }),
      },
      {
        route: 'budgets',
        body: () => ({
          name: `T011 budget ${unique()}`,
          amount: 1000000,
          startsAt: '2026-09-01T00:00:00.000Z',
        }),
        privileged: [
          ['userId', 'userId', () => other.id],
          ['deletedAt', 'deletedAt', () => new Date().toISOString()],
        ],
        count: (userId) => prisma.budget.count({ where: { userId } }),
        find: (id) => prisma.budget.findUnique({ where: { id } }),
      },
      {
        route: 'goals',
        body: () => ({ name: `T011 goal ${unique()}`, targetAmount: 5000000 }),
        privileged: [
          ['userId', 'userId', () => other.id],
          ['deletedAt', 'deletedAt', () => new Date().toISOString()],
        ],
        count: (userId) => prisma.goal.count({ where: { userId } }),
        find: (id) => prisma.goal.findUnique({ where: { id } }),
      },
    ];

    beforeAll(async () => {
      for (const resource of resources) {
        const response = await user.agent
          .post(`/api/${resource.route}`)
          .send(resource.body())
          .expect(201);
        baselineIds[resource.route] = dataOf<{ id: string }>(response).id;
      }
    });

    describe.each(
      resources.map((resource): [string, OwnedResource] => [
        resource.route,
        resource,
      ]),
    )('/api/%s', (route, resource) => {
      it.each(resource.privileged)(
        `USER gets 400 on POST /${route} with %s and nothing is stored`,
        async (_label, field, value) => {
          const mine = await resource.count(user.id);
          const theirs = await resource.count(other.id);
          await user.agent
            .post(`/api/${route}`)
            .send({ ...resource.body(), [field]: value() })
            .expect(400)
            .expect(namesField(field));
          expect(await resource.count(user.id)).toBe(mine);
          expect(await resource.count(other.id)).toBe(theirs);
        },
      );

      it.each(resource.privileged)(
        `USER gets 400 on PATCH /${route}/:ownId with %s and the stored row is unchanged`,
        async (_label, field, value) => {
          const id = baselineIds[route];
          const before = snapshot(await resource.find(id));
          await user.agent
            .patch(`/api/${route}/${idPath(id)}`)
            .send({ [field]: value() })
            .expect(400)
            .expect(namesField(field));
          expect(snapshot(await resource.find(id))).toEqual(before);
        },
      );
    });
  });

  describe('administrator authorization (ACTIVE ADMIN)', () => {
    it('ADMIN gets 200 on PATCH /users/:id for role and status of another account and the change is stored', async () => {
      await admin.agent
        .patch(`/api/users/${idPath(target.id)}`)
        .send({ role: 'ADMIN' })
        .expect(200);
      expect((await storedUser(target.id)).role).toBe('ADMIN');

      await admin.agent
        .patch(`/api/users/${idPath(target.id)}`)
        .send({ role: 'USER', status: 'DISABLED' })
        .expect(200);
      const stored = await storedUser(target.id);
      expect(stored.role).toBe('USER');
      expect(stored.status).toBe('DISABLED');

      await prisma.user.update({
        where: { id: target.id },
        data: { status: 'ACTIVE' },
      });
    });

    it('ADMIN gets 201 on POST /users and the account is stored with the requested role and status', async () => {
      const email = syntheticEmail('t011-admin-created');
      attemptedEmails.push(email);
      const response = await admin.agent
        .post('/api/users')
        .send({
          email,
          fullName: 'E2E admin-created',
          role: 'USER',
          status: 'ACTIVE',
        })
        .expect(201);
      expect(dataOf<UserView>(response).email).toBe(email);
      const stored = await prisma.user.findFirstOrThrow({ where: { email } });
      expect(stored.role).toBe('USER');
      expect(stored.status).toBe('ACTIVE');
    });

    it('ADMIN is allowed (2xx) on POST /users/list', async () => {
      expectAllowed(await listUsers(admin.agent));
    });

    it('ADMIN account responses expose identity/status fields only (no settings, no password hash)', async () => {
      const read = await admin.agent
        .get(`/api/users/${idPath(target.id)}`)
        .expect(200);
      const updated = await admin.agent
        .patch(`/api/users/${idPath(target.id)}`)
        .send({ fullName: 'E2E target renamed by admin' })
        .expect(200);
      const email = syntheticEmail('t011-admin-shape');
      attemptedEmails.push(email);
      const created = await admin.agent
        .post('/api/users')
        .send({ email, fullName: 'E2E admin shape' })
        .expect(201);

      for (const response of [read, updated, created]) {
        const view = dataOf<UserView>(response);
        expect(view).not.toHaveProperty('settings');
        expect(view).not.toHaveProperty('passwordHash');
        expect(view).not.toHaveProperty('metadata');
        for (const key of Object.keys(view)) {
          expect(ADMIN_VISIBLE_USER_FIELDS).toContain(key);
        }
      }
    });
  });

  describe('persisted role and status are read on every request', () => {
    it('a USER (403 on POST /users/list) promoted in the database is allowed on the next request with the same access token', async () => {
      const promoted = await registerExtra('t011-promoted');
      await listUsers(promoted.agent).expect(403);
      await promoteToAdminForTest(prisma, promoted.id);
      expectAllowed(await listUsers(promoted.agent));
    });

    it('an ADMIN demoted in the database gets 403 on the next request with the same access token', async () => {
      const demoted = await registerExtra('t011-demoted');
      await promoteToAdminForTest(prisma, demoted.id);
      expectAllowed(await listUsers(demoted.agent));
      await prisma.user.update({
        where: { id: demoted.id },
        data: { role: 'USER' },
      });
      await listUsers(demoted.agent).expect(403);
    });

    it.each([
      ['DISABLED', { status: 'DISABLED' }],
      ['PENDING_DELETE', { status: 'PENDING_DELETE' }],
      ['soft-deleted', { deletedAt: new Date() }],
    ] as Array<[string, Prisma.UserUpdateInput]>)(
      'an ADMIN whose account becomes %s gets 401 on protected routes with the same access token',
      async (label, change) => {
        const blocked = await registerExtra(`t011-admin-${label}`);
        await promoteToAdminForTest(prisma, blocked.id);
        expectAllowed(await listUsers(blocked.agent));
        await prisma.user.update({ where: { id: blocked.id }, data: change });
        await listUsers(blocked.agent).expect(401);
        await blocked.agent.get('/api/users/me').expect(401);
        await blocked.agent.get('/api/auth/me').expect(401);
      },
    );
  });

  describe('bank providers (no network write path)', () => {
    const writes: Array<['post' | 'patch' | 'delete', string]> = [
      ['post', ''],
      ['patch', '/:id'],
      ['delete', '/:id'],
    ];

    it.each(
      ['USER', 'ADMIN'].flatMap((role) => writes.map((w) => [role, ...w])),
    )(
      '%s gets 404 on %s /bank-providers%s (no write route exists)',
      async (role, method, suffix) => {
        const agent = role === 'ADMIN' ? admin.agent : user.agent;
        const before = snapshot(
          await prisma.bankProvider.findUniqueOrThrow({
            where: { id: bankProviderId },
          }),
        );
        const path = suffix
          ? `/api/bank-providers/${idPath(bankProviderId)}`
          : '/api/bank-providers';
        const body = { code: `T011${RUN_ID}`, name: 'T011 provider' };
        const call =
          method === 'post'
            ? agent.post(path)
            : method === 'patch'
              ? agent.patch(path)
              : agent.delete(path);
        await call.send(body).expect(404);
        expect(
          snapshot(
            await prisma.bankProvider.findUniqueOrThrow({
              where: { id: bankProviderId },
            }),
          ),
        ).toEqual(before);
        expect(
          await prisma.bankProvider.count({ where: { code: body.code } }),
        ).toBe(0);
      },
    );

    it('USER gets 200 on GET /bank-providers', async () => {
      const response = await user.agent.get('/api/bank-providers').expect(200);
      expect(Array.isArray(dataOf<unknown[]>(response))).toBe(true);
    });

    it('unauthenticated gets 401 on GET /bank-providers', async () => {
      await anon().get('/api/bank-providers').expect(401);
    });
  });

  describe('parser templates (global configuration)', () => {
    it('USER gets 403 on POST /parser-templates and no template is created', async () => {
      const body = templateBody('user-create');
      await user.agent.post('/api/parser-templates').send(body).expect(403);
      expect(
        await prisma.parserTemplate.count({ where: { name: body.name } }),
      ).toBe(0);
    });

    it('USER gets 403 on PATCH /parser-templates/:id and the template is unchanged', async () => {
      const before = snapshot(
        await prisma.parserTemplate.findUniqueOrThrow({
          where: { id: fixtureTemplateId },
          include: { fields: true },
        }),
      );
      await user.agent
        .patch(`/api/parser-templates/${idPath(fixtureTemplateId)}`)
        .send({ priority: 0 })
        .expect(403);
      expect(
        snapshot(
          await prisma.parserTemplate.findUniqueOrThrow({
            where: { id: fixtureTemplateId },
            include: { fields: true },
          }),
        ),
      ).toEqual(before);
    });

    it('USER gets 403 on PATCH /parser-templates/:id for an absent id', async () => {
      await user.agent
        .patch(`/api/parser-templates/${idPath(absentId())}`)
        .send({ priority: 0 })
        .expect(403);
    });

    it('unauthenticated gets 401 on GET, POST, and PATCH parser templates', async () => {
      await anon().get('/api/parser-templates').expect(401);
      await anon()
        .post('/api/parser-templates')
        .send(templateBody('anon-create'))
        .expect(401);
      await anon()
        .patch(`/api/parser-templates/${idPath(fixtureTemplateId)}`)
        .send({ priority: 0 })
        .expect(401);
    });

    it('ADMIN gets 201 on POST /parser-templates', async () => {
      const body = templateBody('admin-create');
      const response = await admin.agent
        .post('/api/parser-templates')
        .send(body)
        .expect(201);
      const created = dataOf<TemplateView>(response);
      expect(created.name).toBe(body.name);
      expect(
        await prisma.parserTemplate.count({ where: { id: created.id } }),
      ).toBe(1);
    });

    it('ADMIN gets 200 on PATCH /parser-templates/:id and the change is stored', async () => {
      const response = await admin.agent
        .patch(`/api/parser-templates/${idPath(fixtureTemplateId)}`)
        .send({ priority: 998 })
        .expect(200);
      expect(dataOf<TemplateView>(response).priority).toBe(998);
      const stored = await prisma.parserTemplate.findUniqueOrThrow({
        where: { id: fixtureTemplateId },
      });
      expect(stored.priority).toBe(998);
      expect(stored.isActive).toBe(false);
    });

    it('USER gets 200 on GET /parser-templates', async () => {
      const response = await user.agent
        .get('/api/parser-templates')
        .expect(200);
      expect(Array.isArray(dataOf<unknown[]>(response))).toBe(true);
    });
  });
});
