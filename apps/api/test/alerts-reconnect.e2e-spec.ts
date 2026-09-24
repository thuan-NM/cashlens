import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { App } from 'supertest/types';
import {
  GmailOAuthService,
  GmailReconnectRequiredError,
} from '../src/modules/email-connections/gmail-oauth.service';
import {
  GmailApiError,
  GmailApiService,
} from '../src/modules/email-ingestion/gmail-api.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryEmailTransport } from './fakes/in-memory-email-transport';
import {
  TestUser,
  cleanupUsers,
  dataOf,
  idPath,
  registerUser,
} from './helpers/auth-fixtures';
import {
  GMAIL_READONLY,
  createGmailConnection,
  createListenRule,
} from './helpers/email-fixtures';
import {
  MutableClock,
  alertsOf,
  alertsWithKey,
  createAlertTestApp,
} from './helpers/alert-fixtures';

jest.setTimeout(180_000);
void createTestApp; // imported first for its side effect

/**
 * T090 (SC-007, ALERT-009 reconnect-required row): a provider-auth failure
 * (a refused token renewal, or a 401 during a sync) opens a SYSTEM CRITICAL
 * alert; a reconnect or a user disconnect resolves it; a user disconnect
 * and a project-wide 403 never open one.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');

describe('Reconnect-required alerts (T090)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const clock = new MutableClock(NOW);
  const transport = new InMemoryEmailTransport();
  const users: TestUser[] = [];
  let listSpy: jest.SpiedFunction<GmailApiService['listMessageIds']>;
  let refreshSpy: jest.SpiedFunction<GmailOAuthService['refreshAccessToken']>;
  let exchangeSpy: jest.SpiedFunction<GmailOAuthService['exchangeCode']>;
  let profileSpy: jest.SpiedFunction<GmailOAuthService['profile']>;

  const setup = async (label: string) => {
    const user = await registerUser(app, label);
    users.push(user);
    const connection = await createGmailConnection(app, user.id, label);
    await createListenRule(user.agent, {
      connectionId: connection.id,
      senderEmail: 'notify@vcb.example.test',
      bankProviderId: 'bank_vcb',
    });
    const syncPath = `/api/email-connections/${idPath(connection.id)}/sync`;
    return {
      user,
      connection,
      syncPath,
      key: `reconnect:${connection.id}`,
    };
  };

  /** The access token is due for renewal at the next sync. */
  const expireAccessToken = (connectionId: string) =>
    prisma.emailConnection.update({
      where: { id: connectionId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });

  /** The OAuth callback for the same mailbox: a reconnect. */
  const reconnect = async (user: TestUser, emailAddress: string) => {
    exchangeSpy.mockResolvedValueOnce({
      access_token: randomBytes(24).toString('base64url'),
      refresh_token: randomBytes(24).toString('base64url'),
      expires_in: 3600,
      scope: GMAIL_READONLY,
      token_type: 'Bearer',
    });
    profileSpy.mockResolvedValueOnce({
      emailAddress,
      messagesTotal: 0,
      threadsTotal: 0,
      historyId: '1',
    });
    const connect = await user.agent
      .post('/api/email-connections/gmail/connect')
      .expect(201);
    const url = new URL(
      dataOf<{ authorizationUrl: string }>(connect).authorizationUrl,
    );
    await user.agent
      .get('/api/email-connections/gmail/callback')
      .query({
        state: url.searchParams.get('state'),
        code: randomBytes(16).toString('base64url'),
      })
      .expect(200);
  };

  beforeAll(async () => {
    app = await createAlertTestApp({ clock, transport });
    prisma = app.get(PrismaService);
    const oauth = app.get(GmailOAuthService);
    listSpy = jest
      .spyOn(app.get(GmailApiService), 'listMessageIds')
      .mockResolvedValue({ ids: [] });
    refreshSpy = jest.spyOn(oauth, 'refreshAccessToken');
    exchangeSpy = jest.spyOn(oauth, 'exchangeCode');
    profileSpy = jest.spyOn(oauth, 'profile');
    jest.spyOn(oauth, 'revokeToken').mockResolvedValue(true);
  });

  beforeEach(() => transport.reset());

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma)
      await cleanupUsers(
        prisma,
        users.map((user) => user.id),
      );
    await app?.close();
  });

  it('a refused token renewal opens a SYSTEM CRITICAL alert, emailed when opted in', async () => {
    const { user, connection, syncPath, key } = await setup(
      'us5-reconnect-renew',
    );
    await user.agent
      .patch('/api/alerts/settings')
      .send({ type: 'SYSTEM', emailEnabled: true })
      .expect(200);
    await expireAccessToken(connection.id);
    refreshSpy.mockRejectedValueOnce(new GmailReconnectRequiredError());

    const refused = await user.agent.post(syncPath).expect(503);
    expect(refused.body).toMatchObject({ code: 'RECONNECT_REQUIRED' });

    const [alert] = await alertsWithKey(user.agent, key);
    expect(alert).toMatchObject({
      type: 'SYSTEM',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      resourceType: 'email_connection',
      resourceId: connection.id,
      metadata: expect.objectContaining({
        condition: 'RECONNECT_REQUIRED',
      }) as object,
      emailDelivery: expect.objectContaining({
        status: 'SENT',
        attemptCount: 1,
      }) as object,
    });
    const [message] = transport.sent;
    expect(message.text).toContain('Email connection');
    expect(message.text).not.toContain(connection.emailAddress);
    expect(message.text).not.toContain(connection.accessToken);

    // Refused again: the open alert is not duplicated or re-sent.
    await user.agent.post(syncPath).expect(503);
    expect(await alertsWithKey(user.agent, key)).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it('a 401 during a sync opens it; the reconnect resolves it with RECONNECTED', async () => {
    const { user, connection, syncPath, key } =
      await setup('us5-reconnect-401');
    listSpy.mockRejectedValueOnce(new GmailApiError('AUTH', 401));
    await user.agent.post(syncPath).expect(201);
    expect((await alertsWithKey(user.agent, key)).map((a) => a.status)).toEqual(
      ['ACTIVE'],
    );

    await reconnect(user, connection.emailAddress);
    expect(await alertsWithKey(user.agent, key)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'RECONNECTED',
      }),
    ]);
  });

  it('a project-wide 403 (REFUSED) never counts as reconnect-required', async () => {
    const { user, syncPath, key } = await setup('us5-reconnect-403');
    listSpy.mockRejectedValueOnce(new GmailApiError('REFUSED', 403));
    await user.agent.post(syncPath).expect(201);
    expect(await alertsWithKey(user.agent, key)).toEqual([]);
  });

  it('a user disconnect never alerts, and resolves an open alert with DISCONNECTED', async () => {
    const plain = await setup('us5-reconnect-plain');
    await plain.user.agent
      .delete(`/api/email-connections/${idPath(plain.connection.id)}`)
      .expect(200);
    expect(
      (await alertsOf(plain.user.agent)).filter((a) => a.conditionKey !== null),
    ).toEqual([]);

    const open = await setup('us5-reconnect-open');
    listSpy.mockRejectedValueOnce(new GmailApiError('AUTH', 401));
    await open.user.agent.post(open.syncPath).expect(201);
    await open.user.agent
      .delete(`/api/email-connections/${idPath(open.connection.id)}`)
      .expect(200);
    expect(await alertsWithKey(open.user.agent, open.key)).toEqual([
      expect.objectContaining({
        status: 'RESOLVED',
        resolutionReason: 'DISCONNECTED',
      }),
    ]);
  });
});
