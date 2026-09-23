import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config before AppModule loads
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  syntheticEmail,
} from './helpers/auth-fixtures';

/**
 * T017 [SEC-001, SEC-002, SEC-005, TEST-003]: users and settings ownership
 * matrix. Encodes the specified behavior, so some cases stay red until
 * T018-T025 land:
 * - ordinary users get 403 on every admin-only /users route, whatever the id;
 * - self-service routes (GET /users/me, PATCH /users/me, PATCH
 *   /users/me/settings) act on the caller only and reject privileged fields;
 * - administrators see account identity/status only (no settings), get 404
 *   for absent or malformed ids, and a soft-deleted user's sessions end;
 * - every /users route requires authentication.
 */

jest.setTimeout(30_000);

const LABEL = 'ous'; // suite prefix for every synthetic identity
const USERS_API = '/api/users';

// Fields an administrator may see on another account (contract: identity/status only).
const ADMIN_VIEW_FIELDS = [
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

type Method = 'get' | 'post' | 'patch' | 'delete';

type SettingsView = {
  storeRawEmailBody: boolean;
  allowAiInsights: boolean;
  autoClassificationEnabled: boolean;
  defaultMonthStartDay: number;
  dataRetentionDays: number | null;
  notificationEnabled: boolean;
};

type UserView = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  status: string;
  settings?: SettingsView | null;
  [key: string]: unknown;
};

type UserList = { data: UserView[]; total: number };

const IdCases: Array<{ label: string; id: string }> = [
  { label: 'an absent id', id: absentId() },
  ...MALFORMED_IDS.map((id) => ({
    label:
      id.length > 20
        ? `a malformed id (${id.length} characters)`
        : `malformed id ${JSON.stringify(id)}`,
    id,
  })),
];

function hit(
  client: Agent,
  method: Method,
  path: string,
  body?: object,
): request.Test {
  let pending: request.Test;
  switch (method) {
    case 'get':
      pending = client.get(path);
      break;
    case 'post':
      pending = client.post(path);
      break;
    case 'patch':
      pending = client.patch(path);
      break;
    case 'delete':
      pending = client.delete(path);
      break;
  }
  return body ? pending.send(body) : pending;
}

const bodyText = (response: request.Response): string =>
  JSON.stringify(response.body ?? null);

describe('Users and settings ownership matrix (T017)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  /** Ordinary caller. */
  let alice: TestUser;
  /** Read-only reference user: never the target of a mutation attempt. */
  let bob: TestUser;
  /** Target of an ordinary user's PATCH /users/:id attempt. */
  let carol: TestUser;
  /** Target of an ordinary user's DELETE /users/:id attempt. */
  let dave: TestUser;
  /** Administrator (test-only promotion in the shared test database). */
  let admin: TestUser;
  /** Soft-deleted by the administrator. */
  let victim: TestUser;

  const accountOf = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        email: true,
        fullName: true,
        role: true,
        status: true,
        timezone: true,
        locale: true,
        baseCurrency: true,
        deletedAt: true,
        metadata: true,
      },
    });

  const settingsOf = (userId: string) =>
    prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: {
        storeRawEmailBody: true,
        allowAiInsights: true,
        autoClassificationEnabled: true,
        defaultMonthStartDay: true,
        dataRetentionDays: true,
        notificationEnabled: true,
        metadata: true,
      },
    });

  const anonymous = (): Agent => request.agent(app.getHttpServer());

  /** Identity/status only: no settings, no field outside the admin view. */
  function expectAdminView(view: UserView, expected?: TestUser): void {
    expect(view).not.toHaveProperty('settings');
    expect(
      Object.keys(view).filter((key) => !ADMIN_VIEW_FIELDS.includes(key)),
    ).toEqual([]);
    if (expected) {
      expect(view.id).toBe(expected.id);
      expect(view.email).toBe(expected.email);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    // Sequential on purpose: Supertest opens and closes an ephemeral listener
    // per request on a non-listening server, so parallel calls can reset each
    // other's sockets and leave in-flight registrations behind cleanup.
    alice = await registerUser(app, `${LABEL}-alice`);
    bob = await registerUser(app, `${LABEL}-bob`);
    carol = await registerUser(app, `${LABEL}-carol`);
    dave = await registerUser(app, `${LABEL}-dave`);
    admin = await registerUser(app, `${LABEL}-admin`);
    victim = await registerUser(app, `${LABEL}-victim`);
    await promoteToAdminForTest(prisma, admin.id);
    // Fresh session so the admin's token claim matches the persisted role;
    // same-token promotion is covered by the T011/T012 suites.
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Everything this run created carries the suite prefix and RUN_ID,
      // including any user a failing case may have created by accident.
      const mine = await prisma.user.findMany({
        where: {
          AND: [
            { email: { startsWith: `${LABEL}-` } },
            { email: { contains: `-${RUN_ID}-` } },
            { email: { endsWith: '@example.test' } },
          ],
        },
        select: { id: true },
      });
      await cleanupUsers(prisma, [
        alice?.id,
        bob?.id,
        carol?.id,
        dave?.id,
        admin?.id,
        victim?.id,
        ...mine.map((row) => row.id),
      ]);
    }
    await app?.close();
  }, 60_000);

  describe('unauthenticated access to /users routes', () => {
    const routes: Array<{
      name: string;
      method: Method;
      path: () => string;
      body?: () => object;
    }> = [
      {
        name: 'POST /users/list',
        method: 'post',
        path: () => `${USERS_API}/list`,
        body: () => ({}),
      },
      {
        name: 'POST /users',
        method: 'post',
        path: () => USERS_API,
        body: () => ({
          email: syntheticEmail(`${LABEL}-unauth`),
          fullName: 'E2E unauthenticated create',
        }),
      },
      { name: 'GET /users/me', method: 'get', path: () => `${USERS_API}/me` },
      {
        name: 'PATCH /users/me',
        method: 'patch',
        path: () => `${USERS_API}/me`,
        body: () => ({ fullName: 'E2E unauthenticated profile' }),
      },
      {
        name: 'PATCH /users/me/settings',
        method: 'patch',
        path: () => `${USERS_API}/me/settings`,
        body: () => ({ notificationEnabled: false }),
      },
      {
        name: 'GET /users/:id',
        method: 'get',
        path: () => `${USERS_API}/${idPath(bob.id)}`,
      },
      {
        name: 'PATCH /users/:id',
        method: 'patch',
        path: () => `${USERS_API}/${idPath(bob.id)}`,
        body: () => ({ fullName: 'E2E unauthenticated update' }),
      },
      {
        name: 'DELETE /users/:id',
        method: 'delete',
        path: () => `${USERS_API}/${idPath(bob.id)}`,
      },
    ];

    it.each(routes)(
      'request without a session gets 401 on $name and changes nothing',
      async ({ method, path, body }) => {
        const accountBefore = await accountOf(bob.id);
        const settingsBefore = await settingsOf(bob.id);
        const payload = body?.();

        const response = await hit(anonymous(), method, path(), payload);

        expect(response.status).toBe(401);
        expect(bodyText(response)).not.toContain(bob.email);
        expect(await accountOf(bob.id)).toEqual(accountBefore);
        expect(await settingsOf(bob.id)).toEqual(settingsBefore);
        if (payload && 'email' in payload) {
          expect(
            await prisma.user.count({
              where: { email: String(payload.email) },
            }),
          ).toBe(0);
        }
      },
    );

    it.each(routes)(
      'request with a forged ADMIN access token gets 401 on $name',
      async ({ method, path, body }) => {
        const forged = new JwtService({
          secret: randomBytes(32).toString('hex'),
        }).sign({ sub: admin.id, email: admin.email, role: 'ADMIN' });
        const accountBefore = await accountOf(bob.id);

        const response = await hit(anonymous(), method, path(), body?.()).set(
          'Cookie',
          `accessToken=${forged}`,
        );

        expect(response.status).toBe(401);
        expect(bodyText(response)).not.toContain(bob.email);
        expect(await accountOf(bob.id)).toEqual(accountBefore);
      },
    );
  });

  describe('ordinary USER on admin-only routes', () => {
    it('USER gets 403 on POST /users/list and no account is disclosed', async () => {
      const plain = await alice.agent.post(`${USERS_API}/list`).send({});
      expect(plain.status).toBe(403);
      expect(bodyText(plain)).not.toContain(bob.email);

      const searched = await alice.agent
        .post(`${USERS_API}/list`)
        .send({ search: bob.email });
      expect(searched.status).toBe(403);
      expect(bodyText(searched)).not.toContain(bob.email);
    });

    it("USER gets 403 on GET /users/:id for another user's existing id", async () => {
      const response = await alice.agent.get(`${USERS_API}/${idPath(bob.id)}`);

      expect(response.status).toBe(403);
      expect(bodyText(response)).not.toContain(bob.email);
    });

    it.each(IdCases)(
      'USER gets 403 on GET /users/:id with $label',
      async ({ id }) => {
        const response = await alice.agent.get(`${USERS_API}/${idPath(id)}`);
        expect(response.status).toBe(403);
      },
    );

    it("USER gets 403 on PATCH /users/:id for another user's existing id and the account is unchanged", async () => {
      const before = await accountOf(carol.id);
      expect(before.deletedAt).toBeNull();

      const response = await alice.agent
        .patch(`${USERS_API}/${idPath(carol.id)}`)
        .send({ fullName: 'E2E changed by another user' });

      expect(response.status).toBe(403);
      expect(bodyText(response)).not.toContain(carol.email);
      expect(await accountOf(carol.id)).toEqual(before);
    });

    it.each(IdCases)(
      'USER gets 403 on PATCH /users/:id with $label',
      async ({ id }) => {
        const response = await alice.agent
          .patch(`${USERS_API}/${idPath(id)}`)
          .send({ fullName: 'E2E changed by another user' });
        expect(response.status).toBe(403);
      },
    );

    it("USER gets 403 on DELETE /users/:id for another user's existing id and the account is not deleted", async () => {
      const before = await accountOf(dave.id);
      expect(before.deletedAt).toBeNull();

      const response = await alice.agent.delete(
        `${USERS_API}/${idPath(dave.id)}`,
      );

      expect(response.status).toBe(403);
      expect(bodyText(response)).not.toContain(dave.email);
      expect(await accountOf(dave.id)).toEqual(before);
    });

    it.each(IdCases)(
      'USER gets 403 on DELETE /users/:id with $label',
      async ({ id }) => {
        const response = await alice.agent.delete(`${USERS_API}/${idPath(id)}`);
        expect(response.status).toBe(403);
      },
    );
  });

  describe('ordinary USER self-service', () => {
    it("USER GET /users/me returns the caller's own profile with settings", async () => {
      const response = await alice.agent.get(`${USERS_API}/me`);

      expect(response.status).toBe(200);
      const me = dataOf<UserView>(response);
      expect(me.id).toBe(alice.id);
      expect(me.email).toBe(alice.email);
      expect(me.role).toBe('USER');
      expect(me.settings).toEqual(
        expect.objectContaining({
          allowAiInsights: expect.any(Boolean) as boolean,
          autoClassificationEnabled: expect.any(Boolean) as boolean,
          defaultMonthStartDay: expect.any(Number) as number,
          notificationEnabled: expect.any(Boolean) as boolean,
        }),
      );
      expect(me).not.toHaveProperty('passwordHash');
      expect(bodyText(response)).not.toContain(bob.email);
    });

    it("USER PATCH /users/me/settings changes only the caller's settings", async () => {
      const before = await settingsOf(alice.id);
      const otherBefore = await settingsOf(bob.id);
      const change = {
        allowAiInsights: !before.allowAiInsights,
        notificationEnabled: !before.notificationEnabled,
        defaultMonthStartDay: before.defaultMonthStartDay === 15 ? 16 : 15,
        dataRetentionDays: before.dataRetentionDays === 90 ? 91 : 90,
      };

      const response = await alice.agent
        .patch(`${USERS_API}/me/settings`)
        .send(change);

      expect(response.status).toBe(200);
      expect(bodyText(response)).not.toContain(bob.email);
      expect(await settingsOf(alice.id)).toEqual({ ...before, ...change });
      expect(await settingsOf(bob.id)).toEqual(otherBefore);
    });

    it("USER gets 400 on PATCH /users/me/settings with another user's userId and nobody's settings change", async () => {
      const before = await settingsOf(alice.id);
      const otherBefore = await settingsOf(bob.id);

      const response = await alice.agent
        .patch(`${USERS_API}/me/settings`)
        .send({
          userId: bob.id,
          notificationEnabled: !otherBefore.notificationEnabled,
        });

      expect(response.status).toBe(400);
      expect(await settingsOf(alice.id)).toEqual(before);
      expect(await settingsOf(bob.id)).toEqual(otherBefore);
    });

    it("USER PATCH /users/me updates only the caller's profile fields", async () => {
      const before = await accountOf(alice.id);
      const otherBefore = await accountOf(bob.id);
      const change = {
        fullName: `E2E ${LABEL} renamed ${randomBytes(3).toString('hex')}`,
        timezone:
          before.timezone === 'Asia/Tokyo' ? 'Europe/Paris' : 'Asia/Tokyo',
        locale: before.locale === 'en-US' ? 'fr-FR' : 'en-US',
        baseCurrency: before.baseCurrency === 'USD' ? 'EUR' : 'USD',
      };

      const response = await alice.agent.patch(`${USERS_API}/me`).send(change);

      expect(response.status).toBe(200);
      expect(bodyText(response)).not.toContain(bob.email);
      expect(bodyText(response)).not.toContain('passwordHash');
      expect(await accountOf(alice.id)).toEqual({ ...before, ...change });
      expect(await accountOf(bob.id)).toEqual(otherBefore);
    });

    const privilegedFields: Array<{ field: string; value: () => unknown }> = [
      { field: 'role', value: () => 'ADMIN' },
      { field: 'status', value: () => 'DISABLED' },
      { field: 'email', value: () => syntheticEmail(`${LABEL}-hijack`) },
      { field: 'userId', value: () => bob.id },
      { field: 'id', value: () => bob.id },
      { field: 'deletedAt', value: () => new Date().toISOString() },
      { field: 'metadata', value: () => ({ userId: bob.id }) },
    ];

    it.each(privilegedFields)(
      'USER gets 400 on PATCH /users/me with $field and nothing changes',
      async ({ field, value }) => {
        const before = await accountOf(alice.id);
        const otherBefore = await accountOf(bob.id);

        const response = await alice.agent.patch(`${USERS_API}/me`).send({
          fullName: `E2E ${LABEL} must not apply`,
          [field]: value(),
        });

        expect(response.status).toBe(400);
        expect(await accountOf(alice.id)).toEqual(before);
        expect(await accountOf(bob.id)).toEqual(otherBefore);
      },
    );
  });

  describe('ADMIN account management', () => {
    it('ADMIN POST /users/list succeeds and returns identity/status fields only (no settings)', async () => {
      const response = await admin.agent
        .post(`${USERS_API}/list`)
        .send({ search: bob.email, pageSize: 100 });

      // The route's success code is not fixed by the contract (201 today).
      expect([200, 201]).toContain(response.status);
      const list = dataOf<UserList>(response);
      expect(list.data.map((user) => user.id)).toEqual([bob.id]);
      expectAdminView(list.data[0], bob);
      expect(list.data[0].role).toBe('USER');
      expect(list.data[0].status).toBe('ACTIVE');
    });

    it('ADMIN POST /users/list never exposes settings for any listed account', async () => {
      const response = await admin.agent
        .post(`${USERS_API}/list`)
        .send({ pageSize: 100 });

      expect([200, 201]).toContain(response.status);
      const list = dataOf<UserList>(response);
      expect(list.data.length).toBeGreaterThan(0);
      for (const user of list.data) {
        expectAdminView(user);
      }
    });

    it("ADMIN GET /users/:id returns another user's identity/status without settings", async () => {
      const response = await admin.agent.get(`${USERS_API}/${idPath(bob.id)}`);

      expect(response.status).toBe(200);
      const view = dataOf<UserView>(response);
      expectAdminView(view, bob);
      expect(view.role).toBe('USER');
      expect(view.status).toBe('ACTIVE');
    });

    const adminIdCases = (['get', 'patch', 'delete'] as const).flatMap(
      (method) =>
        IdCases.map((idCase) => ({
          ...idCase,
          method,
          verb: method.toUpperCase(),
        })),
    );

    it.each(adminIdCases)(
      'ADMIN gets 404 on $verb /users/:id with $label',
      async ({ method, id }) => {
        const response = await hit(
          admin.agent,
          method,
          `${USERS_API}/${idPath(id)}`,
          method === 'patch' ? { fullName: 'E2E not applied' } : undefined,
        );
        expect(response.status).toBe(404);
      },
    );

    describe('ADMIN DELETE /users/:id on another user', () => {
      let deleteStatus: number;
      let settingsBefore: Awaited<ReturnType<typeof settingsOf>>;

      beforeAll(async () => {
        // Positive controls: the victim's session and refresh cookie work
        // before the deletion. Refresh rotates both cookies in the agent; the
        // rotated pair is still issued before the deletion.
        await victim.agent.get(`${USERS_API}/me`).expect(200);
        await victim.agent.post('/api/auth/refresh').expect(200);
        await victim.agent.get(`${USERS_API}/me`).expect(200);
        expect((await accountOf(victim.id)).deletedAt).toBeNull();
        settingsBefore = await settingsOf(victim.id);

        const response = await admin.agent.delete(
          `${USERS_API}/${idPath(victim.id)}`,
        );
        deleteStatus = response.status;
      });

      it('ADMIN DELETE /users/:id returns 200 and soft-deletes the account (row kept, deletedAt set)', async () => {
        expect(deleteStatus).toBe(200);
        const stored = await prisma.user.findUnique({
          where: { id: victim.id },
          select: { deletedAt: true },
        });
        expect(stored).not.toBeNull();
        expect(stored?.deletedAt).toBeInstanceOf(Date);
      });

      it("the deleted user's existing access token gets 401 on GET /users/me", async () => {
        const response = await victim.agent.get(`${USERS_API}/me`);
        expect(response.status).toBe(401);
      });

      it("the deleted user's existing access token gets 401 on GET /auth/me", async () => {
        const response = await victim.agent.get('/api/auth/me');
        expect(response.status).toBe(401);
      });

      it("the deleted user's existing access token gets 401 on PATCH /users/me/settings and settings stay unchanged", async () => {
        const response = await victim.agent
          .patch(`${USERS_API}/me/settings`)
          .send({ notificationEnabled: !settingsBefore.notificationEnabled });

        expect(response.status).toBe(401);
        expect(await settingsOf(victim.id)).toEqual(settingsBefore);
      });

      it('ADMIN GET /users/:id for the soft-deleted account gets 404', async () => {
        const response = await admin.agent.get(
          `${USERS_API}/${idPath(victim.id)}`,
        );
        expect(response.status).toBe(404);
      });

      it("the deleted user's refresh token gets 401 on POST /auth/refresh", async () => {
        const response = await victim.agent.post('/api/auth/refresh');
        expect(response.status).toBe(401);
      });
    });
  });
});
