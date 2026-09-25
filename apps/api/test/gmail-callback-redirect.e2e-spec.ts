import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import {
  BadGatewayException,
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { App } from 'supertest/types';
import { GmailOAuthService } from '../src/modules/email-connections/gmail-oauth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  registerUser,
} from './helpers/auth-fixtures';

/**
 * The Gmail OAuth callback returns the browser to the web app (contract 302
 * target). A browser navigation (Accept: text/html) is redirected to the
 * configured web origin's Email page with a fixed outcome code only: never a
 * token, code, state, or message. API clients keep the enveloped JSON.
 */
describe('Gmail OAuth callback redirect', () => {
  const WEB = 'http://localhost:5173'; // development CORS_ORIGIN default
  const CALLBACK = '/api/email-connections/gmail/callback';
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let oauth: GmailOAuthService;
  let user: TestUser;

  const startFlow = async () => {
    const connect = await user.agent
      .post('/api/email-connections/gmail/connect')
      .expect(201);
    return new URL(
      dataOf<{ authorizationUrl: string }>(connect).authorizationUrl,
    ).searchParams.get('state');
  };

  const grant = () =>
    jest.spyOn(oauth, 'exchangeCode').mockResolvedValueOnce({
      access_token: randomBytes(24).toString('base64url'),
      refresh_token: randomBytes(24).toString('base64url'),
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      token_type: 'Bearer',
    });

  const connectionCount = () =>
    prisma.emailConnection.count({ where: { userId: user.id } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    oauth = app.get(GmailOAuthService);
    user = await registerUser(app, 'gmail-callback-redirect');
    jest.spyOn(oauth, 'profile').mockResolvedValue({
      emailAddress: `mailbox-${randomBytes(4).toString('hex')}@example.test`,
      messagesTotal: 0,
      threadsTotal: 0,
      historyId: '1',
    });
    jest.spyOn(oauth, 'revokeToken').mockResolvedValue(true);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) await cleanupUsers(prisma, [user?.id]);
    await app?.close();
  });

  it('a browser returns to the Email page after a successful connect, with no secret in the URL', async () => {
    const state = await startFlow();
    grant();
    const code = randomBytes(16).toString('base64url');

    const res = await user.agent
      .get(CALLBACK)
      .set('Accept', 'text/html,application/xhtml+xml')
      .query({ state, code })
      .expect(303);

    expect(res.headers.location).toBe(`${WEB}/app/email?gmail=connected`);
    expect(res.headers.location).not.toContain(code);
    expect(await connectionCount()).toBe(1);
    // The nonce cookie is single-use, whatever the outcome.
    expect(String(res.headers['set-cookie'])).toMatch(/gmailOAuthNonce=;/);
  });

  it.each([
    ['an invalid state', 'STATE_INVALID', () => undefined, 'forged-state'],
    [
      'Google refusing the code',
      'GOOGLE_REFUSED',
      () =>
        jest
          .spyOn(oauth, 'exchangeCode')
          .mockRejectedValueOnce(new BadGatewayException()),
      null,
    ],
    [
      'Google being unavailable',
      'GOOGLE_UNAVAILABLE',
      () =>
        jest
          .spyOn(oauth, 'exchangeCode')
          .mockRejectedValueOnce(new ServiceUnavailableException()),
      null,
    ],
  ])(
    'a browser returns to the Email page with a fixed reason after %s',
    async (_label, reason, arrange, forcedState) => {
      const before = await connectionCount();
      const state = forcedState ?? (await startFlow());
      arrange();

      const res = await user.agent
        .get(CALLBACK)
        .set('Accept', 'text/html')
        .query({ state, code: randomBytes(16).toString('base64url') })
        .expect(303);

      expect(res.headers.location).toBe(
        `${WEB}/app/email?gmail=failed&reason=${reason}`,
      );
      expect(await connectionCount()).toBe(before);
    },
  );

  it('ignores any redirect target in the request: the web origin comes from configuration', async () => {
    const res = await user.agent
      .get(CALLBACK)
      .set('Accept', 'text/html')
      .query({ state: 'forged', code: 'x', redirect: 'https://evil.example' })
      .expect(303);
    expect(new URL(res.headers.location).origin).toBe(WEB);
  });

  it('an API client keeps the enveloped JSON contract (200 on success, 401 on a bad state)', async () => {
    const state = await startFlow();
    grant();
    const ok = await user.agent
      .get(CALLBACK)
      .query({ state, code: randomBytes(16).toString('base64url') })
      .expect(200);
    expect(ok.body).toMatchObject({ success: true });
    expect(dataOf<{ status: string }>(ok).status).toBe('ACTIVE');

    const bad = await user.agent
      .get(CALLBACK)
      .query({ state: 'forged', code: 'x' })
      .expect(401);
    expect(bad.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
