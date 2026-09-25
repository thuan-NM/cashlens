import { startProductionServer, ProductionServer } from './helpers/test-app'; // first: seeds synthetic config
import { randomBytes } from 'crypto';
import { spawnSync } from 'child_process';
import { join } from 'path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveE2eDatabaseUrl } from './helpers/test-database';
import { syntheticEmail } from './helpers/auth-fixtures';

jest.setTimeout(180_000);

/**
 * T095 captured-log check (OPS-008, ERR-006, EMAIL-002): the real entry point
 * (src/main.ts) runs in production mode in its own process with its JSON log
 * captured. Real requests (sign-up, sign-in, renewal, a Gmail callback with
 * an OAuth code and state, a validation failure) must leave no credential,
 * token, OAuth value, or configured secret in the log, while every line of a
 * request carries the correlation id the client received, and the request
 * line records the peer address (T100 TRUST_PROXY check).
 */

const synthetic = (label: string) =>
  `t095-${label}-${randomBytes(18).toString('base64url')}`;

const SECRETS = {
  JWT_SECRET: synthetic('jwt-secret'),
  EMAIL_TOKEN_ENCRYPTION_KEY: synthetic('encryption-key'),
  GMAIL_CLIENT_SECRET: synthetic('gmail-client-secret'),
  GMAIL_OAUTH_STATE_SECRET: synthetic('oauth-state-secret'),
};

type LogLine = Record<string, unknown> & {
  correlationId?: string;
  event?: string;
  req?: { url?: string; remoteAddress?: string };
};

describe('captured production log (T095)', () => {
  let server: ProductionServer;
  const email = syntheticEmail('t095-log');
  const password = `T095-${randomBytes(9).toString('base64url')}!a1`;
  const oauthCode = `4/${synthetic('oauth-code')}`;
  const oauthState = synthetic('oauth-state');
  const leaked: string[] = [];

  const lines = (): LogLine[] =>
    server
      .stdout()
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as LogLine);
  const https = (method: 'get' | 'post' | 'patch', path: string) =>
    request(server.baseUrl)[method](path).set('X-Forwarded-Proto', 'https');
  const cookiesOf = (res: request.Response) =>
    ([] as string[])
      .concat((res.headers['set-cookie'] as unknown as string[]) ?? [])
      .map((cookie) => cookie.split(';')[0]);

  beforeAll(async () => {
    server = await startProductionServer(
      { ...SECRETS, LOG_LEVEL: 'info' },
      { captureStdout: true },
    );
  });

  afterAll(async () => {
    await server?.stop();
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: resolveE2eDatabaseUrl() }),
    });
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  it('runs the journeys, then finds no secret in the log', async () => {
    await https('post', '/api/auth/register')
      .send({ email, password, fullName: 'T095 Log' })
      .expect(201);
    const login = await https('post', '/api/auth/login')
      .send({ email, password })
      .expect(200);
    const cookies = cookiesOf(login);
    const tokens = cookies.map((cookie) => cookie.split('=')[1]);
    expect(tokens.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    leaked.push(...tokens);

    await https('post', '/api/auth/refresh')
      .set('Cookie', cookies.join('; '))
      .expect(200);
    await https('post', '/api/auth/login')
      .send({ email, password: `${password}-wrong` })
      .expect(401);
    // The callback URL carries the OAuth code and state; the state is not
    // bound to this browser, so it is refused before Google is called.
    await https(
      'get',
      `/api/email-connections/gmail/callback?code=${encodeURIComponent(oauthCode)}&state=${encodeURIComponent(oauthState)}`,
    ).expect(401);
    await https('patch', '/api/users/me/settings')
      .set('Cookie', cookies.join('; '))
      .send({ password, token: tokens[0] })
      .expect(400);

    // Let the last request lines flush.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const log = server.stdout();
    expect(log.length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries({
      password,
      oauthCode,
      oauthState,
      ...SECRETS,
      ...Object.fromEntries(leaked.map((token, i) => [`cookie${i}`, token])),
    })) {
      const found =
        log.includes(value) || log.includes(encodeURIComponent(value));
      expect({ name, found }).toEqual({ name, found: false });
    }
    expect(log).not.toContain(email); // no address is logged either
  });

  it('writes structured events carrying the request correlation id', async () => {
    const res = await https('post', '/api/auth/login')
      .send({ email, password })
      .expect(200);
    const correlationId = (res.body as { correlationId: string }).correlationId;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const mine = lines().filter((line) => line.correlationId === correlationId);
    expect(mine.map((line) => line.event).filter(Boolean)).toContain(
      'auth.login',
    );
    const requestLine = mine.find(
      (line) => line.req?.url === '/api/auth/login',
    );
    expect(requestLine?.req?.remoteAddress).toMatch(/127\.0\.0\.1|::1/);
    expect(lines().some((line) => line.event === 'app.started')).toBe(true);
    const callback = lines().find((line) =>
      line.req?.url?.startsWith('/api/email-connections/gmail/callback'),
    );
    expect(callback?.req?.url).toContain('code=%5BREDACTED%5D');
    expect(lines().some((line) => line.event === 'auth.login_failed')).toBe(
      true,
    );
  });
});

describe('startup failure (T095 review F2)', () => {
  it('an invalid production configuration logs one structured app.start_failed event, without values', () => {
    const badSecret = 'short-synthetic-secret';
    const result = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', join('src', 'main.ts')],
      {
        cwd: join(__dirname, '..'),
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          NODE_ENV: 'production',
          JWT_SECRET: badSecret,
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    expect(result.status).toBe(1);
    const event = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === 'app.start_failed');
    expect(event).toMatchObject({
      errorName: 'ConfigValidationError',
      configIssues: expect.arrayContaining([
        'JWT_SECRET: must contain at least 32 characters',
      ]) as string[],
    });
    expect(`${result.stdout}${result.stderr}`).not.toContain(badSecret);
  });
});
