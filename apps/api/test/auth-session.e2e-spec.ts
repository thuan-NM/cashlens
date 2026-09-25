import { createTestApp, startProductionServer } from './helpers/test-app';
import type { ProductionServer } from './helpers/test-app';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupUsers,
  dataOf,
  syntheticEmail,
  syntheticPassword,
} from './helpers/auth-fixtures';

// T012 [AUTH-001..AUTH-005, OPS-009, TEST-004]: session lifecycle.
// These tests encode the specification; some fail until T025/T026 land.
// Token values are never printed: every assertion that involves a token
// compares booleans, counts, cookie names, or cookie attributes only.

jest.setTimeout(30_000);

const AUTH = '/api/auth';
const FORWARDED_HTTPS = { 'X-Forwarded-Proto': 'https' };
const PROTECTED_ROUTES = [
  '/api/auth/me',
  '/api/users/me',
  '/api/financial-accounts',
];
const SECRET_KEYS = [
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'accesstokenencrypted',
  'refreshtokenencrypted',
];
const VOLATILE_ERROR_KEYS = new Set(['timestamp', 'correlationId', 'path']);

type Account = { id: string; email: string; password: string };
type Session = { accessToken: string; refreshToken: string };
type SetCookie = { name: string; value: string; attributes: string[] };
type ErrorBody = { statusCode?: number; message?: unknown; code?: string };

/** Every created identity, so cleanup covers users made by any mode. */
const createdEmails: string[] = [];
/** Passwords, password hashes, tokens and token hashes seen in this run. */
const knownSecrets = new Set<string>();
/** Every response, for the final no-leak sweep. */
const observed: Array<{ label: string; res: request.Response }> = [];

function remember(...values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (value) {
      knownSecrets.add(value);
    }
  }
}

function observe(label: string, res: request.Response): request.Response {
  observed.push({ label, res });
  return res;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function parseSetCookies(res: request.Response): SetCookie[] {
  const header = (res.headers as Record<string, unknown>)['set-cookie'];
  const lines = Array.isArray(header)
    ? header.map((line) => String(line))
    : typeof header === 'string'
      ? [header]
      : [];
  return lines.map((line) => {
    const [pair = '', ...attributes] = line
      .split(';')
      .map((part) => part.trim());
    const separator = pair.indexOf('=');
    return {
      name: separator < 0 ? pair : pair.slice(0, separator),
      value: separator < 0 ? '' : pair.slice(separator + 1),
      attributes: attributes.map((attribute) => attribute.toLowerCase()),
    };
  });
}

/** Names of cookies the response sets (values are never exposed). */
const cookieNames = (res: request.Response) =>
  parseSetCookies(res).map((cookie) => cookie.name);

function issuedCookie(
  res: request.Response,
  name: string,
): SetCookie | undefined {
  return parseSetCookies(res).find(
    (cookie) => cookie.name === name && cookie.value !== '',
  );
}

function clearedCookie(
  res: request.Response,
  name: string,
): SetCookie | undefined {
  return parseSetCookies(res).find(
    (cookie) =>
      cookie.name === name &&
      cookie.value === '' &&
      cookie.attributes.some(
        (attribute) =>
          attribute.startsWith('expires=') && attribute.includes('1970'),
      ),
  );
}

/** Reads both session cookies; asserts presence without printing values. */
function sessionFrom(res: request.Response): Session {
  const access = issuedCookie(res, 'accessToken');
  const refresh = issuedCookie(res, 'refreshToken');
  expect({
    accessTokenCookie: access !== undefined,
    refreshTokenCookie: refresh !== undefined,
  }).toEqual({ accessTokenCookie: true, refreshTokenCookie: true });
  const session = {
    accessToken: access?.value ?? '',
    refreshToken: refresh?.value ?? '',
  };
  remember(
    session.accessToken,
    session.refreshToken,
    sha256(decodeURIComponent(session.refreshToken)),
  );
  return session;
}

function secretKeysIn(value: unknown, path = 'body'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      secretKeysIn(item, `${path}[${index}]`),
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => [
        ...(SECRET_KEYS.includes(key.toLowerCase()) ? [`${path}.${key}`] : []),
        ...secretKeysIn(child, `${path}.${key}`),
      ],
    );
  }
  return [];
}

/** Describes leaks without revealing the leaked values. */
function leaksIn(res: request.Response): string[] {
  const text = res.text || JSON.stringify(res.body ?? null);
  const found = secretKeysIn(res.body as unknown);
  const valueCount = [...knownSecrets].filter((secret) =>
    text.includes(secret),
  ).length;
  if (valueCount) {
    found.push(`${valueCount} known secret value(s) in the body`);
  }
  return found;
}

/** Status plus the error body without per-request fields. */
function errorShape(res: request.Response) {
  const body = (res.body ?? {}) as Record<string, unknown>;
  return {
    status: res.status,
    body: Object.fromEntries(
      Object.entries(body).filter(([key]) => !VOLATILE_ERROR_KEYS.has(key)),
    ),
  };
}

function refusal(res: request.Response) {
  const body = (res.body ?? {}) as ErrorBody;
  return { status: res.status, statusCode: body.statusCode, code: body.code };
}

describe('Auth sessions (T012)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;

  const http = () => request(app.getHttpServer());

  async function passwordHashOf(email: string): Promise<string | null> {
    const row = await prisma.user.findUnique({
      where: { email },
      select: { passwordHash: true },
    });
    return row?.passwordHash ?? null;
  }

  async function registerAccount(label: string): Promise<Account> {
    const email = syntheticEmail(label);
    const password = syntheticPassword();
    createdEmails.push(email);
    remember(password);
    const res = observe(
      'POST /auth/register',
      await http()
        .post(`${AUTH}/register`)
        .send({ email, password, fullName: `E2E ${label}` }),
    );
    expect(res.status).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    remember(row.passwordHash);
    return { id: row.id, email, password };
  }

  async function signIn(account: Account): Promise<Session> {
    const res = observe(
      'POST /auth/login',
      await http()
        .post(`${AUTH}/login`)
        .send({ email: account.email, password: account.password }),
    );
    expect(res.status).toBe(200);
    return sessionFrom(res);
  }

  const refreshWith = (refreshToken: string) =>
    http()
      .post(`${AUTH}/refresh`)
      .set('Cookie', `refreshToken=${refreshToken}`);

  const getWithAccess = (path: string, accessToken: string) =>
    http().get(path).set('Cookie', `accessToken=${accessToken}`);

  const loginAttempt = (email: string, password: string) =>
    http().post(`${AUTH}/login`).send({ email, password });

  beforeAll(async () => {
    app = await createTestApp();
    // Listen explicitly so parallel requests share one live server.
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    if (prisma && createdEmails.length) {
      const users = await prisma.user.findMany({
        where: { email: { in: createdEmails } },
        select: { id: true },
      });
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    }
    await app?.close();
  }, 60_000);

  describe('development mode', () => {
    describe('registration (AUTH-001)', () => {
      it('POST /auth/register returns 201, creates an ACTIVE USER, and sets no cookie', async () => {
        const email = syntheticEmail('session-register');
        const password = syntheticPassword();
        createdEmails.push(email);
        remember(password);

        const res = observe(
          'POST /auth/register',
          await http()
            .post(`${AUTH}/register`)
            .send({ email, password, fullName: 'E2E session-register' }),
        );

        expect(res.status).toBe(201);
        expect(cookieNames(res)).toEqual([]);
        const stored = await prisma.user.findUniqueOrThrow({
          where: { email },
          select: { role: true, status: true, passwordHash: true },
        });
        remember(stored.passwordHash);
        expect({ role: stored.role, status: stored.status }).toEqual({
          role: 'USER',
          status: 'ACTIVE',
        });
        expect(leaksIn(res)).toEqual([]);
      });
    });

    describe('login (AUTH-003, AUTH-004)', () => {
      let account: Account;

      beforeAll(async () => {
        account = await registerAccount('session-login');
      });

      it('POST /auth/login returns 200 and sets HttpOnly, SameSite=Lax accessToken and refreshToken cookies (refresh scoped to /api/auth) with no token in the body', async () => {
        const res = observe(
          'POST /auth/login',
          await loginAttempt(account.email, account.password),
        );

        expect(res.status).toBe(200);
        sessionFrom(res);
        expect(issuedCookie(res, 'accessToken')?.attributes).toEqual(
          expect.arrayContaining(['httponly', 'samesite=lax']),
        );
        expect(issuedCookie(res, 'refreshToken')?.attributes).toEqual(
          expect.arrayContaining([
            'httponly',
            'samesite=lax',
            'path=/api/auth',
          ]),
        );
        expect(leaksIn(res)).toEqual([]);
      });

      it('unknown email and wrong password get the identical 401 status and message, and no cookie', async () => {
        const unknown = observe(
          'POST /auth/login (unknown email)',
          await loginAttempt(
            syntheticEmail('session-unknown'),
            syntheticPassword(),
          ),
        );
        const wrong = observe(
          'POST /auth/login (wrong password)',
          await loginAttempt(account.email, syntheticPassword()),
        );

        expect(unknown.status).toBe(401);
        expect(errorShape(wrong)).toEqual(errorShape(unknown));
        expect((unknown.body as ErrorBody).message).toBeTruthy();
        expect(cookieNames(unknown)).toEqual([]);
        expect(cookieNames(wrong)).toEqual([]);
      });
    });

    describe('access token (AUTH-002)', () => {
      let account: Account;
      let session: Session;

      beforeAll(async () => {
        account = await registerAccount('session-access');
        session = await signIn(account);
      });

      it('GET /auth/me with a valid access cookie returns 200 with the caller identity and no secrets', async () => {
        const res = observe(
          'GET /auth/me',
          await getWithAccess('/api/auth/me', session.accessToken),
        );

        expect(res.status).toBe(200);
        expect(dataOf<{ id: string }>(res).id).toBe(account.id);
        expect(leaksIn(res)).toEqual([]);
      });

      it('GET /auth/me without a session returns 401', async () => {
        const res = observe(
          'GET /auth/me (no session)',
          await http().get('/api/auth/me'),
        );

        expect(res.status).toBe(401);
      });

      it('an expired access token gets the same 401 as no session, while a fresh token for the same user gets 200', async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const claims = { sub: account.id, email: account.email, role: 'USER' };
        // Issued an hour ago with a one-minute lifetime: already expired.
        const expired = jwt.sign(
          { ...claims, iat: nowSeconds - 3600 },
          { expiresIn: 60 },
        );
        const fresh = jwt.sign(claims, { expiresIn: 300 });
        remember(expired, fresh);

        const expiredRes = observe(
          'GET /auth/me (expired token)',
          await getWithAccess('/api/auth/me', expired),
        );
        const noSession = observe(
          'GET /auth/me (no session)',
          await http().get('/api/auth/me'),
        );
        const freshRes = observe(
          'GET /auth/me (fresh token)',
          await getWithAccess('/api/auth/me', fresh),
        );

        expect(expiredRes.status).toBe(401);
        expect(errorShape(expiredRes)).toEqual(errorShape(noSession));
        expect(freshRes.status).toBe(200);
      });

      it('an access token signed with another secret gets the same 401 as no session', async () => {
        const forged = jwt.sign(
          { sub: account.id, email: account.email, role: 'ADMIN' },
          { secret: randomBytes(32).toString('hex'), expiresIn: 300 },
        );
        remember(forged);

        const res = observe(
          'GET /auth/me (foreign secret)',
          await getWithAccess('/api/auth/me', forged),
        );
        const noSession = observe(
          'GET /auth/me (no session)',
          await http().get('/api/auth/me'),
        );

        expect(res.status).toBe(401);
        expect(errorShape(res)).toEqual(errorShape(noSession));
      });
    });

    describe('refresh rotation and reuse (AUTH-001, AUTH-002, AUTH-004)', () => {
      let account: Account;

      beforeAll(async () => {
        account = await registerAccount('session-refresh');
      });

      it('POST /auth/refresh without a refresh cookie returns 401 and sets no cookie', async () => {
        const res = observe(
          'POST /auth/refresh (no cookie)',
          await http().post(`${AUTH}/refresh`),
        );

        expect(res.status).toBe(401);
        expect(cookieNames(res)).toEqual([]);
      });

      it('a JSON-shaped refresh cookie (cookie-parser "j:" value) is treated as absent: 401 on refresh, 200 on logout, never 500', async () => {
        // cookie-parser turns `j:{...}` values into objects; only a string is a token.
        const cookie = `refreshToken=${encodeURIComponent('j:{"token":"x"}')}`;
        const refresh = observe(
          'POST /auth/refresh (object cookie)',
          await http().post(`${AUTH}/refresh`).set('Cookie', cookie),
        );
        expect(refresh.status).toBe(401);
        expect(cookieNames(refresh)).toEqual([]);

        const logout = await http()
          .post(`${AUTH}/logout`)
          .set('Cookie', cookie);
        expect(logout.status).toBe(200);
      });

      it('POST /auth/refresh returns 200 with a NEW refresh cookie (HttpOnly, SameSite=Lax, Path=/api/auth), a working access cookie, and no token in the body', async () => {
        const session = await signIn(account);

        const res = observe(
          'POST /auth/refresh',
          await refreshWith(session.refreshToken),
        );

        expect(res.status).toBe(200);
        const rotated = sessionFrom(res);
        expect(rotated.refreshToken === session.refreshToken).toBe(false);
        expect(issuedCookie(res, 'refreshToken')?.attributes).toEqual(
          expect.arrayContaining([
            'httponly',
            'samesite=lax',
            'path=/api/auth',
          ]),
        );
        expect(issuedCookie(res, 'accessToken')?.attributes).toEqual(
          expect.arrayContaining(['httponly', 'samesite=lax']),
        );
        expect(leaksIn(res)).toEqual([]);

        const me = observe(
          'GET /auth/me (rotated access)',
          await getWithAccess('/api/auth/me', rotated.accessToken),
        );
        expect(me.status).toBe(200);
      });

      it('replaying a rotated refresh token returns 401, identical to a never-issued token', async () => {
        const session = await signIn(account);
        const first = observe(
          'POST /auth/refresh',
          await refreshWith(session.refreshToken),
        );
        expect(first.status).toBe(200);
        sessionFrom(first);

        const replay = observe(
          'POST /auth/refresh (replayed token)',
          await refreshWith(session.refreshToken),
        );
        const unknownToken = randomBytes(64).toString('base64url');
        remember(unknownToken);
        const unknown = observe(
          'POST /auth/refresh (unknown token)',
          await refreshWith(unknownToken),
        );

        expect(replay.status).toBe(401);
        expect(errorShape(replay)).toEqual(errorShape(unknown));
        expect(issuedCookie(replay, 'accessToken')).toBeUndefined();
        expect(issuedCookie(replay, 'refreshToken')).toBeUndefined();
      });

      it('two concurrent refreshes with the same token: exactly one 200 and one 401, and only one new session exists (every round)', async () => {
        const racer = await registerAccount('session-race');
        const activeTokens = () =>
          prisma.refreshToken.count({
            where: {
              userId: racer.id,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
        // Open several pooled database connections first, so the two
        // refreshes genuinely overlap instead of queuing on one connection.
        await Promise.all(
          Array.from({ length: 4 }, () => http().get('/api/health/ready')),
        );

        const rounds: Array<{ statuses: number[]; newSessions: number }> = [];
        for (let round = 0; round < 3; round += 1) {
          const before = await activeTokens();
          const session = await signIn(racer);
          const responses = await Promise.all([
            refreshWith(session.refreshToken),
            refreshWith(session.refreshToken),
          ]);
          responses.forEach((res) =>
            observe('POST /auth/refresh (concurrent)', res),
          );
          responses
            .filter((res) => res.status === 200)
            .forEach((res) => sessionFrom(res));
          rounds.push({
            statuses: responses.map((res) => res.status).sort(),
            newSessions: (await activeTokens()) - before,
          });
        }

        expect(rounds).toEqual(
          rounds.map(() => ({ statuses: [200, 401], newSessions: 1 })),
        );
      });
    });

    describe('logout and logout-all (AUTH-001)', () => {
      let account: Account;

      beforeAll(async () => {
        account = await registerAccount('session-logout');
      });

      it('POST /auth/logout returns 200, clears both cookies, and that refresh token then gets 401', async () => {
        const session = await signIn(account);

        const res = observe(
          'POST /auth/logout',
          await http()
            .post(`${AUTH}/logout`)
            .set(
              'Cookie',
              `accessToken=${session.accessToken}; refreshToken=${session.refreshToken}`,
            ),
        );

        expect(res.status).toBe(200);
        expect(clearedCookie(res, 'accessToken')).toBeDefined();
        expect(clearedCookie(res, 'refreshToken')?.attributes).toEqual(
          expect.arrayContaining(['path=/api/auth']),
        );
        expect(leaksIn(res)).toEqual([]);

        const after = observe(
          'POST /auth/refresh (after logout)',
          await refreshWith(session.refreshToken),
        );
        expect(after.status).toBe(401);
      });

      it('POST /auth/logout ends only the current session: another session of the same user can still refresh', async () => {
        const current = await signIn(account);
        const other = await signIn(account);

        const res = observe(
          'POST /auth/logout',
          await http()
            .post(`${AUTH}/logout`)
            .set('Cookie', `refreshToken=${current.refreshToken}`),
        );
        expect(res.status).toBe(200);

        const otherRefresh = observe(
          'POST /auth/refresh (other session)',
          await refreshWith(other.refreshToken),
        );
        expect(otherRefresh.status).toBe(200);
        sessionFrom(otherRefresh);
      });

      it('POST /auth/logout-all from one agent revokes the refresh tokens of both agents of the same user', async () => {
        const agentA = request.agent(app.getHttpServer());
        const agentB = request.agent(app.getHttpServer());
        const credentials = {
          email: account.email,
          password: account.password,
        };
        const loginA = observe(
          'POST /auth/login (agent A)',
          await agentA.post(`${AUTH}/login`).send(credentials),
        );
        const loginB = observe(
          'POST /auth/login (agent B)',
          await agentB.post(`${AUTH}/login`).send(credentials),
        );
        expect([loginA.status, loginB.status]).toEqual([200, 200]);
        const sessionA = sessionFrom(loginA);
        const sessionB = sessionFrom(loginB);

        const res = observe(
          'POST /auth/logout-all',
          await agentA.post(`${AUTH}/logout-all`),
        );
        expect(res.status).toBe(200);
        expect(leaksIn(res)).toEqual([]);

        const refreshA = observe(
          'POST /auth/refresh (agent A after logout-all)',
          await refreshWith(sessionA.refreshToken),
        );
        const refreshB = observe(
          'POST /auth/refresh (agent B after logout-all)',
          await refreshWith(sessionB.refreshToken),
        );
        const agentBRefresh = observe(
          'POST /auth/refresh (agent B cookie jar)',
          await agentB.post(`${AUTH}/refresh`),
        );
        expect([
          refreshA.status,
          refreshB.status,
          agentBRefresh.status,
        ]).toEqual([401, 401, 401]);
      });

      it('POST /auth/logout-all without a session returns 401', async () => {
        const res = observe(
          'POST /auth/logout-all (no session)',
          await http().post(`${AUTH}/logout-all`),
        );

        expect(res.status).toBe(401);
      });
    });

    describe('disabled, pending-delete, and soft-deleted accounts (AUTH-002, AUTH-004)', () => {
      const INACTIVE_STATES: Array<{
        label: string;
        change: () => Prisma.UserUpdateInput;
      }> = [
        { label: 'DISABLED', change: () => ({ status: 'DISABLED' }) },
        {
          label: 'PENDING_DELETE',
          change: () => ({ status: 'PENDING_DELETE' }),
        },
        { label: 'soft-deleted', change: () => ({ deletedAt: new Date() }) },
      ];

      it.each(INACTIVE_STATES)(
        '$label account: login with the correct password gets the same generic 401 and message as an unknown email, and no cookie',
        async ({ label, change }) => {
          const account = await registerAccount(
            `session-inactive-login-${label}`,
          );
          await prisma.user.update({
            where: { id: account.id },
            data: change(),
          });

          const res = observe(
            `POST /auth/login (${label})`,
            await loginAttempt(account.email, account.password),
          );
          const unknown = observe(
            'POST /auth/login (unknown email)',
            await loginAttempt(
              syntheticEmail('session-unknown'),
              syntheticPassword(),
            ),
          );

          expect(res.status).toBe(401);
          expect(errorShape(res)).toEqual(errorShape(unknown));
          expect(cookieNames(res)).toEqual([]);
        },
      );

      it.each(INACTIVE_STATES)(
        '$label account: an access token issued before the change gets 401 on protected routes',
        async ({ label, change }) => {
          const account = await registerAccount(
            `session-inactive-access-${label}`,
          );
          const session = await signIn(account);
          const statusesFor = async (tag: string) => {
            const statuses: Record<string, number> = {};
            for (const path of PROTECTED_ROUTES) {
              const res = observe(
                `GET ${path} (${tag})`,
                await getWithAccess(path, session.accessToken),
              );
              statuses[path] = res.status;
            }
            return statuses;
          };

          // Control: the same token works while the account is active.
          expect(await statusesFor('active')).toEqual(
            Object.fromEntries(PROTECTED_ROUTES.map((path) => [path, 200])),
          );

          await prisma.user.update({
            where: { id: account.id },
            data: change(),
          });

          expect(await statusesFor(label)).toEqual(
            Object.fromEntries(PROTECTED_ROUTES.map((path) => [path, 401])),
          );
        },
      );

      it.each(INACTIVE_STATES)(
        '$label account: POST /auth/refresh with its refresh token gets 401 and sets no session cookie',
        async ({ label, change }) => {
          const account = await registerAccount(
            `session-inactive-refresh-${label}`,
          );
          const session = await signIn(account);
          await prisma.user.update({
            where: { id: account.id },
            data: change(),
          });

          const res = observe(
            `POST /auth/refresh (${label})`,
            await refreshWith(session.refreshToken),
          );

          expect(res.status).toBe(401);
          expect(issuedCookie(res, 'accessToken')).toBeUndefined();
          expect(issuedCookie(res, 'refreshToken')).toBeUndefined();
        },
      );
    });

    describe('audit evidence (AUTH-005)', () => {
      it('login, refresh, and logout-all are audited for the user without passwords, password hashes, tokens, or token hashes', async () => {
        const account = await registerAccount('session-audit');
        const countRows = () =>
          prisma.auditLog.count({
            where: { OR: [{ userId: account.id }, { resourceId: account.id }] },
          });

        const beforeLogin = await countRows();
        const session = await signIn(account);
        const afterLogin = await countRows();

        const refreshed = observe(
          'POST /auth/refresh',
          await refreshWith(session.refreshToken),
        );
        expect(refreshed.status).toBe(200);
        const rotated = sessionFrom(refreshed);
        const afterRefresh = await countRows();

        const loggedOut = observe(
          'POST /auth/logout-all',
          await http()
            .post(`${AUTH}/logout-all`)
            .set('Cookie', `accessToken=${rotated.accessToken}`),
        );
        expect(loggedOut.status).toBe(200);
        const afterLogoutAll = await countRows();

        expect({
          login: afterLogin > beforeLogin,
          refresh: afterRefresh > afterLogin,
          logoutAll: afterLogoutAll > afterRefresh,
        }).toEqual({ login: true, refresh: true, logoutAll: true });

        const rows = await prisma.auditLog.findMany({
          where: { OR: [{ userId: account.id }, { resourceId: account.id }] },
        });
        const secrets = [
          account.password,
          (await passwordHashOf(account.email)) ?? '',
          session.accessToken,
          session.refreshToken,
          sha256(decodeURIComponent(session.refreshToken)),
          rotated.accessToken,
          rotated.refreshToken,
          sha256(decodeURIComponent(rotated.refreshToken)),
        ].filter(Boolean);
        const leakingRows = rows.filter((row) => {
          const text = JSON.stringify(row);
          return secrets.some((secret) => text.includes(secret));
        });
        expect(leakingRows.map((row) => row.action)).toEqual([]);
      });
    });
  });

  describe('production mode (NODE_ENV=production, TRUST_PROXY=loopback, OPS-009)', () => {
    let server: ProductionServer | undefined;
    let account: Account;

    const prod = () => {
      if (!server) {
        throw new Error('The production server is not running.');
      }
      return request(server.baseUrl);
    };

    async function registerInProduction(
      label: string,
    ): Promise<{ account: Account; res: request.Response }> {
      const email = syntheticEmail(label);
      const password = syntheticPassword();
      createdEmails.push(email);
      remember(password);
      const res = observe(
        'prod POST /auth/register (https)',
        await prod()
          .post(`${AUTH}/register`)
          .set(FORWARDED_HTTPS)
          .send({ email, password, fullName: `E2E ${label}` }),
      );
      const row = await prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });
      remember(row?.passwordHash);
      return { account: { id: row?.id ?? '', email, password }, res };
    }

    async function signInOverHttps(target: Account): Promise<Session> {
      const res = observe(
        'prod POST /auth/login (https)',
        await prod()
          .post(`${AUTH}/login`)
          .set(FORWARDED_HTTPS)
          .send({ email: target.email, password: target.password }),
      );
      expect(res.status).toBe(200);
      return sessionFrom(res);
    }

    const prodRefresh = (refreshToken: string) =>
      prod()
        .post(`${AUTH}/refresh`)
        .set('Cookie', `refreshToken=${refreshToken}`);

    beforeAll(async () => {
      server = await startProductionServer();
      const registered = await registerInProduction('prod-session');
      if (registered.res.status !== 201) {
        throw new Error(
          `Production registration over https returned ${registered.res.status}.`,
        );
      }
      account = registered.account;
    }, 120_000);

    afterAll(async () => {
      await server?.stop();
    }, 60_000);

    it('GET /api/health/ready over plain HTTP returns 200', async () => {
      const res = observe(
        'prod GET /health/ready (http)',
        await prod().get('/api/health/ready'),
      );

      expect(res.status).toBe(200);
    });

    it('POST /auth/register with X-Forwarded-Proto: https returns 201 and sets no cookie', async () => {
      const { res } = await registerInProduction('prod-register');

      expect(res.status).toBe(201);
      expect(cookieNames(res)).toEqual([]);
      expect(leaksIn(res)).toEqual([]);
    });

    it('POST /auth/login with X-Forwarded-Proto: https returns 200 and sets accessToken and refreshToken cookies with Secure, HttpOnly, SameSite=Lax', async () => {
      const res = observe(
        'prod POST /auth/login (https)',
        await prod()
          .post(`${AUTH}/login`)
          .set(FORWARDED_HTTPS)
          .send({ email: account.email, password: account.password }),
      );

      expect(res.status).toBe(200);
      sessionFrom(res);
      expect(issuedCookie(res, 'accessToken')?.attributes).toEqual(
        expect.arrayContaining(['secure', 'httponly', 'samesite=lax']),
      );
      expect(issuedCookie(res, 'refreshToken')?.attributes).toEqual(
        expect.arrayContaining([
          'secure',
          'httponly',
          'samesite=lax',
          'path=/api/auth',
        ]),
      );
      expect(leaksIn(res)).toEqual([]);
    });

    it('POST /auth/refresh and POST /auth/logout with X-Forwarded-Proto: https succeed with Secure cookies', async () => {
      const session = await signInOverHttps(account);

      const refreshed = observe(
        'prod POST /auth/refresh (https)',
        await prodRefresh(session.refreshToken).set(FORWARDED_HTTPS),
      );
      expect(refreshed.status).toBe(200);
      const rotated = sessionFrom(refreshed);
      expect(issuedCookie(refreshed, 'refreshToken')?.attributes).toEqual(
        expect.arrayContaining(['secure', 'httponly', 'samesite=lax']),
      );
      expect(leaksIn(refreshed)).toEqual([]);

      const loggedOut = observe(
        'prod POST /auth/logout (https)',
        await prod()
          .post(`${AUTH}/logout`)
          .set(FORWARDED_HTTPS)
          .set('Cookie', `refreshToken=${rotated.refreshToken}`),
      );
      expect(loggedOut.status).toBe(200);
    });

    it('POST /auth/register over plain HTTP returns 403 HTTPS_REQUIRED and creates no account', async () => {
      const email = syntheticEmail('prod-plain-register');
      const password = syntheticPassword();
      createdEmails.push(email);
      remember(password);

      const res = observe(
        'prod POST /auth/register (http)',
        await prod()
          .post(`${AUTH}/register`)
          .send({ email, password, fullName: 'E2E prod-plain-register' }),
      );

      expect(refusal(res)).toEqual({
        status: 403,
        statusCode: 403,
        code: 'HTTPS_REQUIRED',
      });
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it.each([
      { variant: 'no forwarded header', headers: {} },
      {
        variant: 'X-Forwarded-Proto: http',
        headers: { 'X-Forwarded-Proto': 'http' },
      },
    ])(
      'POST /auth/login over plain HTTP ($variant) returns 403 HTTPS_REQUIRED and sets no cookie',
      async ({ variant, headers }) => {
        const res = observe(
          `prod POST /auth/login (${variant})`,
          await prod()
            .post(`${AUTH}/login`)
            .set(headers)
            .send({ email: account.email, password: account.password }),
        );

        expect(refusal(res)).toEqual({
          status: 403,
          statusCode: 403,
          code: 'HTTPS_REQUIRED',
        });
        expect(cookieNames(res)).toEqual([]);
      },
    );

    it('POST /auth/refresh over plain HTTP returns 403 HTTPS_REQUIRED and leaves the session refreshable over https', async () => {
      const session = await signInOverHttps(account);

      const res = observe(
        'prod POST /auth/refresh (http)',
        await prodRefresh(session.refreshToken),
      );
      expect(refusal(res)).toEqual({
        status: 403,
        statusCode: 403,
        code: 'HTTPS_REQUIRED',
      });
      expect(cookieNames(res)).toEqual([]);

      const overHttps = observe(
        'prod POST /auth/refresh (https)',
        await prodRefresh(session.refreshToken).set(FORWARDED_HTTPS),
      );
      expect(overHttps.status).toBe(200);
      sessionFrom(overHttps);
    });

    it('POST /auth/logout over plain HTTP returns 403 HTTPS_REQUIRED and does not revoke the session', async () => {
      const session = await signInOverHttps(account);

      const res = observe(
        'prod POST /auth/logout (http)',
        await prod()
          .post(`${AUTH}/logout`)
          .set('Cookie', `refreshToken=${session.refreshToken}`),
      );
      expect(refusal(res)).toEqual({
        status: 403,
        statusCode: 403,
        code: 'HTTPS_REQUIRED',
      });

      const overHttps = observe(
        'prod POST /auth/refresh (https)',
        await prodRefresh(session.refreshToken).set(FORWARDED_HTTPS),
      );
      expect(overHttps.status).toBe(200);
      sessionFrom(overHttps);
    });
  });

  describe('response hygiene (AUTH-004, AUTH-005)', () => {
    it('no response in this suite exposes a token, token hash, password, or password hash', async () => {
      const hashes = await prisma.user.findMany({
        where: { email: { in: createdEmails } },
        select: { passwordHash: true },
      });
      remember(...hashes.map((row) => row.passwordHash));

      expect(observed.length).toBeGreaterThan(0);
      const leaks = observed.flatMap(({ label, res }) =>
        leaksIn(res).map((reason) => `${label} [${res.status}]: ${reason}`),
      );
      expect(leaks).toEqual([]);
    });
  });
});
