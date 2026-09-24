import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { TokenEncryptionService } from '../src/common/security/token-encryption.service';
import { GmailOAuthService } from '../src/modules/email-connections/gmail-oauth.service';
import {
  GmailApiService,
  GmailMessage,
} from '../src/modules/email-ingestion/gmail-api.service';
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
 * T016 [SEC-001, SEC-005, SEC-008, TEST-003, SEC-007]: ownership matrix for
 * the email pipeline (email connections, listen rules, email messages, parser
 * runs, sync runs).
 *
 * Policy under test (scratchpad us1-test-policy.md): a caller who does not
 * own a row gets the same 404 as for an absent id, for reads, updates,
 * deletes and actions alike, and nothing changes. Administrators get no
 * bypass. Malformed ids give 404, never 500. Missing or forged sessions give
 * 401. No response carries provider tokens, token field names, or raw email
 * bodies.
 *
 * Gmail cannot run in tests. Every Google-facing method is replaced by a spy
 * that rejects unless a test stubs it, so no request ever leaves the process.
 * Fake tokens are generated per run and stored encrypted exactly the way the
 * application stores them (TokenEncryptionService, "v1." format).
 *
 * Assertions never print token values: leak checks report labels, and row
 * snapshots carry a "tokensIntact" boolean instead of ciphertext.
 */

jest.setTimeout(30_000);

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const CALLBACK = '/api/email-connections/gmail/callback';
const FORBIDDEN_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'accessTokenEncrypted',
  'refreshTokenEncrypted',
  'access_token',
  'refresh_token',
  'passwordHash',
]);
const REFUSAL_IN_REDIRECT = /error|fail|invalid|denied|refused|reject|expired/i;

// A cookie agent and a bare Supertest client share one type.
type Client = Agent;
type TokenResponse = Awaited<ReturnType<GmailOAuthService['exchangeCode']>>;
type GmailProfile = Awaited<ReturnType<GmailOAuthService['profile']>>;
type ConnectionFixture = {
  id: string;
  emailAddress: string;
  accessPlain: string;
  accessEnc: string;
  refreshEnc: string;
};
type ActorKey = 'bob' | 'admin';
type ActorFixture = {
  user: TestUser;
  connection: ConnectionFixture;
  ruleId: string;
  messageId: string;
};
type IdRoute = [
  name: string,
  send: (client: Client, id: string) => request.Test,
];

// Values that must never appear in any response (labels only are reported).
const secrets: Array<{ label: string; value: string }> = [];
// Alice's private values that must never reach another caller.
const alicePrivate: Array<{ label: string; value: string }> = [];

const fakeToken = () => randomBytes(32).toString('base64url');
const BODY_MARKER = `t016-raw-body-${randomBytes(8).toString('hex')}`;
secrets.push({ label: 'raw email body', value: BODY_MARKER });

describe('Email pipeline ownership matrix (T016)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let encryption: TokenEncryptionService;
  let exchangeSpy: jest.SpiedFunction<GmailOAuthService['exchangeCode']>;
  let profileSpy: jest.SpiedFunction<GmailOAuthService['profile']>;
  let refreshSpy: jest.SpiedFunction<GmailOAuthService['refreshAccessToken']>;
  let listIdsSpy: jest.SpiedFunction<GmailApiService['listMessageIds']>;
  let getMessageSpy: jest.SpiedFunction<GmailApiService['getMessage']>;

  let alice: TestUser;
  let bob: TestUser;
  let admin: TestUser;
  const extraUserIds: string[] = [];
  const actors: Partial<Record<ActorKey, ActorFixture>> = {};

  let aliceConn: ConnectionFixture;
  let aliceSpare: ConnectionFixture;
  let aliceSender: string;
  let aliceRuleId: string;
  let aliceRuleCreated: request.Response;
  let aliceMessageId: string;
  let aliceSyncRunId: string;
  let aliceParserRunId: string;

  const http = (): ReturnType<typeof request> => request(app.getHttpServer());
  const actor = (key: ActorKey): ActorFixture => {
    const fixture = actors[key];
    if (!fixture) throw new Error(`Fixture for ${key} was not created.`);
    return fixture;
  };

  // ---------------------------------------------------------------- helpers

  const offline = (): Promise<never> =>
    Promise.reject(new Error('T016: Google is not reachable from e2e tests'));

  function resetGoogleStubs(): void {
    for (const spy of [
      exchangeSpy,
      profileSpy,
      refreshSpy,
      listIdsSpy,
      getMessageSpy,
    ]) {
      spy.mockClear();
      spy.mockImplementation(offline);
    }
  }

  const googleCalls = (): number =>
    exchangeSpy.mock.calls.length +
    profileSpy.mock.calls.length +
    refreshSpy.mock.calls.length +
    listIdsSpy.mock.calls.length +
    getMessageSpy.mock.calls.length;

  function forbiddenKeyPaths(value: unknown, path = 'body'): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        forbiddenKeyPaths(item, `${path}[${index}]`),
      );
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(
        ([key, child]) => [
          ...(FORBIDDEN_KEYS.has(key) ? [`key ${key} at ${path}`] : []),
          ...forbiddenKeyPaths(child, `${path}.${key}`),
        ],
      );
    }
    return [];
  }

  /** Labels of secrets, token keys or raw bodies found in a response. */
  function leaks(res: request.Response): string[] {
    const text = `${res.text ?? ''}\n${JSON.stringify(res.headers ?? {})}`;
    return [
      ...secrets
        .filter((secret) => text.includes(secret.value))
        .map((secret) => secret.label),
      ...forbiddenKeyPaths(res.body),
    ];
  }

  /** Labels of alice's private values found in another caller's response. */
  function disclosedAliceData(res: request.Response): string[] {
    const text = `${res.text ?? ''}\n${JSON.stringify(res.headers ?? {})}`;
    return alicePrivate
      .filter((item) => text.includes(item.value))
      .map((item) => item.label);
  }

  function errorShape(res: request.Response) {
    const body = (res.body ?? {}) as Record<string, unknown>;
    return {
      status: res.status,
      message: body.message,
      error: body.error,
      code: body.code,
    };
  }

  /** Not owned must look exactly like absent (owner-safe non-disclosure). */
  function expectOwnerSafeNotFound(
    res: request.Response,
    absent: request.Response,
  ): void {
    expect(res.status).toBe(404);
    expect(errorShape(res)).toEqual(errorShape(absent));
    expect(leaks(res)).toEqual([]);
    expect(disclosedAliceData(res)).toEqual([]);
  }

  function refusal(res: request.Response): string {
    if (res.status >= 400 && res.status < 500) return 'refused';
    const location = String(
      (res.headers as Record<string, string | undefined>).location ?? '',
    );
    if (
      res.status >= 300 &&
      res.status < 400 &&
      REFUSAL_IN_REDIRECT.test(location)
    ) {
      return 'refused';
    }
    return `not refused (HTTP ${res.status})`;
  }

  function acceptance(res: request.Response): string {
    if (res.status >= 200 && res.status < 300) return 'accepted';
    const location = String(
      (res.headers as Record<string, string | undefined>).location ?? '',
    );
    if (
      res.status >= 300 &&
      res.status < 400 &&
      !REFUSAL_IN_REDIRECT.test(location)
    ) {
      return 'accepted';
    }
    return `not accepted (HTTP ${res.status})`;
  }

  async function createConnection(
    owner: TestUser,
    label: string,
  ): Promise<ConnectionFixture> {
    const accessPlain = fakeToken();
    const refreshPlain = fakeToken();
    const accessEnc = encryption.encrypt(accessPlain);
    const refreshEnc = encryption.encrypt(refreshPlain);
    const emailAddress = syntheticEmail(`t016-${label}-inbox`);
    const row = await prisma.emailConnection.create({
      data: {
        userId: owner.id,
        provider: 'GMAIL',
        emailAddress,
        providerUserId: emailAddress,
        accessTokenEncrypted: accessEnc,
        refreshTokenEncrypted: refreshEnc,
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopes: [GMAIL_READONLY],
        status: 'ACTIVE',
      },
    });
    secrets.push(
      { label: `${label} access token`, value: accessPlain },
      { label: `${label} refresh token`, value: refreshPlain },
      { label: `${label} access token ciphertext`, value: accessEnc },
      { label: `${label} refresh token ciphertext`, value: refreshEnc },
      {
        label: `${label} access token ciphertext body`,
        value: accessEnc.split('.')[3],
      },
      {
        label: `${label} refresh token ciphertext body`,
        value: refreshEnc.split('.')[3],
      },
    );
    return { id: row.id, emailAddress, accessPlain, accessEnc, refreshEnc };
  }

  async function createRule(
    owner: TestUser,
    connectionId: string,
    label: string,
    senderEmail: string,
  ): Promise<request.Response> {
    return owner.agent
      .post('/api/email-listen-rules')
      .send({
        name: `T016 ${label} rule`,
        emailConnectionId: connectionId,
        senderEmail,
        isEnabled: true,
        priority: 10,
      })
      .expect(201);
  }

  async function createMessage(
    owner: TestUser,
    connectionId: string,
    label: string,
    senderEmail: string,
  ): Promise<string> {
    const row = await prisma.emailMessage.create({
      data: {
        userId: owner.id,
        emailConnectionId: connectionId,
        providerMessageId: `t016-${RUN_ID}-${label}-${randomBytes(4).toString('hex')}`,
        senderEmail,
        subject: `T016 ${label} subject ${randomBytes(4).toString('hex')}`,
        snippet: `T016 ${label} snippet ${randomBytes(4).toString('hex')}`,
        receivedAt: new Date(),
        bodyHash: createHash('sha256').update(label).digest('hex'),
        processingStatus: 'PENDING',
      },
    });
    return row.id;
  }

  async function connectionSnapshot(fixture: ConnectionFixture) {
    const row = await prisma.emailConnection.findUnique({
      where: { id: fixture.id },
    });
    return (
      row && {
        userId: row.userId,
        emailAddress: row.emailAddress,
        status: row.status,
        disconnectedAt: row.disconnectedAt,
        lastSyncedAt: row.lastSyncedAt,
        errorMessage: row.errorMessage,
        tokenExpiresAt: row.tokenExpiresAt,
        updatedAt: row.updatedAt,
        tokensIntact:
          row.accessTokenEncrypted === fixture.accessEnc &&
          row.refreshTokenEncrypted === fixture.refreshEnc,
      }
    );
  }

  /** A user's connections without token material (digest only). */
  async function connectionsOf(userId: string) {
    const rows = await prisma.emailConnection.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      emailAddress: row.emailAddress,
      status: row.status,
      disconnectedAt: row.disconnectedAt,
      updatedAt: row.updatedAt,
      tokenDigest: createHash('sha256')
        .update(`${row.accessTokenEncrypted}|${row.refreshTokenEncrypted}`)
        .digest('hex')
        .slice(0, 16),
    }));
  }

  const ruleSnapshot = (id: string) =>
    prisma.emailListenRule.findUnique({ where: { id } });
  const messageSnapshot = (id: string) =>
    prisma.emailMessage.findUnique({ where: { id } });

  async function alicePipelineCounts() {
    const [syncRuns, parserRuns, transactions, rulesOnConnection] =
      await Promise.all([
        prisma.emailSyncRun.count({
          where: { emailConnectionId: aliceConn.id },
        }),
        prisma.parserRun.count({ where: { emailMessageId: aliceMessageId } }),
        prisma.transaction.count({
          where: { emailMessageId: aliceMessageId },
        }),
        prisma.emailListenRule.count({
          where: { emailConnectionId: aliceConn.id },
        }),
      ]);
    return { syncRuns, parserRuns, transactions, rulesOnConnection };
  }

  async function startConnect(agent: Agent): Promise<string> {
    const res = await agent.post('/api/email-connections/gmail/connect');
    expect([200, 201]).toContain(res.status);
    const { authorizationUrl } = dataOf<{ authorizationUrl: string }>(res);
    const state = new URL(authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('The authorization URL carries no state.');
    return state;
  }

  /** Makes the next token exchange succeed as if a Google account consented. */
  function stubGoogleConsent(label: string): {
    inbox: string;
    accessPlain: string;
  } {
    const inbox = syntheticEmail(`t016-${label}-consenting-inbox`);
    const accessPlain = fakeToken();
    const refreshPlain = fakeToken();
    secrets.push(
      { label: `${label} consent access token`, value: accessPlain },
      { label: `${label} consent refresh token`, value: refreshPlain },
    );
    const tokens: TokenResponse = {
      access_token: accessPlain,
      refresh_token: refreshPlain,
      expires_in: 3600,
      scope: GMAIL_READONLY,
      token_type: 'Bearer',
    };
    const profile: GmailProfile = {
      emailAddress: inbox,
      messagesTotal: 0,
      threadsTotal: 0,
      historyId: '1',
    };
    exchangeSpy.mockResolvedValue(tokens);
    profileSpy.mockResolvedValue(profile);
    return { inbox, accessPlain };
  }

  const completeCallback = (client: Client, state: string | undefined) =>
    client.get(CALLBACK).query({
      ...(state === undefined ? {} : { state }),
      code: randomBytes(16).toString('base64url'),
      scope: GMAIL_READONLY,
    });

  // ------------------------------------------------------------------ setup

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    encryption = app.get(TokenEncryptionService);
    const gmailOAuth = app.get(GmailOAuthService);
    const gmailApi = app.get(GmailApiService);
    exchangeSpy = jest.spyOn(gmailOAuth, 'exchangeCode');
    profileSpy = jest.spyOn(gmailOAuth, 'profile');
    refreshSpy = jest.spyOn(gmailOAuth, 'refreshAccessToken');
    listIdsSpy = jest.spyOn(gmailApi, 'listMessageIds');
    getMessageSpy = jest.spyOn(gmailApi, 'getMessage');
    resetGoogleStubs();

    alice = await registerUser(app, 't016-alice');
    bob = await registerUser(app, 't016-bob');
    admin = await registerUser(app, 't016-admin');
    await promoteToAdminForTest(prisma, admin.id);
    // Sign in again so the administrator's session is issued as ADMIN too.
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);

    // Alice: two connections, one rule (through the API), one message, one
    // sync run and one parser run.
    aliceConn = await createConnection(alice, 'alice');
    aliceSpare = await createConnection(alice, 'alice-spare');
    aliceSender = syntheticEmail('t016-alice-bank-sender');
    aliceRuleCreated = await createRule(
      alice,
      aliceConn.id,
      'alice',
      aliceSender,
    );
    aliceRuleId = dataOf<{ id: string }>(aliceRuleCreated).id;
    aliceMessageId = await createMessage(
      alice,
      aliceConn.id,
      'alice',
      aliceSender,
    );
    aliceSyncRunId = (
      await prisma.emailSyncRun.create({
        data: {
          emailConnectionId: aliceConn.id,
          triggerType: 'MANUAL',
          status: 'SUCCESS',
          finishedAt: new Date(),
          emailsFound: 1,
          emailsMatched: 1,
        },
      })
    ).id;
    aliceParserRunId = (
      await prisma.parserRun.create({
        data: {
          emailMessageId: aliceMessageId,
          status: 'FAILED',
          extractedPayload: {},
          normalizedPayload: {},
          errorMessage: 'T016 synthetic parser failure',
        },
      })
    ).id;
    const aliceMessage = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: aliceMessageId },
    });
    alicePrivate.push(
      { label: 'alice account email', value: alice.email },
      { label: 'alice inbox address', value: aliceConn.emailAddress },
      { label: 'alice spare inbox address', value: aliceSpare.emailAddress },
      { label: 'alice bank sender', value: aliceSender },
      { label: 'alice message subject', value: aliceMessage.subject ?? '' },
      { label: 'alice message snippet', value: aliceMessage.snippet ?? '' },
    );

    // Bob and the administrator each own the same kinds of rows, so their
    // lists are not trivially empty.
    for (const [key, user] of [
      ['bob', bob],
      ['admin', admin],
    ] as const) {
      const connection = await createConnection(user, key);
      const sender = syntheticEmail(`t016-${key}-bank-sender`);
      const rule = await createRule(user, connection.id, key, sender);
      const messageId = await createMessage(user, connection.id, key, sender);
      actors[key] = {
        user,
        connection,
        ruleId: dataOf<{ id: string }>(rule).id,
        messageId,
      };
    }
  });

  afterEach(() => {
    resetGoogleStubs();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) {
      await cleanupUsers(prisma, [
        alice?.id,
        bob?.id,
        admin?.id,
        ...extraUserIds,
      ]);
    }
    await app?.close();
  });

  // --------------------------------------------------- unauthenticated: 401

  describe('missing or forged session', () => {
    const protectedRoutes: Array<
      [name: string, send: (client: Client) => request.Test]
    > = [
      [
        'POST /email-connections/gmail/connect',
        (c) => c.post('/api/email-connections/gmail/connect'),
      ],
      ['GET /email-connections', (c) => c.get('/api/email-connections')],
      [
        'DELETE /email-connections/:id',
        (c) => c.delete(`/api/email-connections/${idPath(aliceConn.id)}`),
      ],
      [
        'POST /email-connections/:id/sync',
        (c) => c.post(`/api/email-connections/${idPath(aliceConn.id)}/sync`),
      ],
      [
        'GET /email-connections/:id/sync-runs',
        (c) =>
          c.get(`/api/email-connections/${idPath(aliceConn.id)}/sync-runs`),
      ],
      ['GET /email-messages', (c) => c.get('/api/email-messages')],
      [
        'GET /email-messages?emailConnectionId=:id',
        (c) =>
          c
            .get('/api/email-messages')
            .query({ emailConnectionId: aliceConn.id }),
      ],
      ['GET /email-listen-rules', (c) => c.get('/api/email-listen-rules')],
      [
        'POST /email-listen-rules',
        (c) =>
          c
            .post('/api/email-listen-rules')
            .send({ name: 'T016 unauthenticated rule' }),
      ],
      [
        'PATCH /email-listen-rules/:id',
        (c) =>
          c
            .patch(`/api/email-listen-rules/${idPath(aliceRuleId)}`)
            .send({ isEnabled: false }),
      ],
      [
        'DELETE /email-listen-rules/:id',
        (c) => c.delete(`/api/email-listen-rules/${idPath(aliceRuleId)}`),
      ],
      [
        'POST /email-messages/:id/parse',
        (c) => c.post(`/api/email-messages/${idPath(aliceMessageId)}/parse`),
      ],
      [
        'GET /email-messages/:id/parser-runs',
        (c) =>
          c.get(`/api/email-messages/${idPath(aliceMessageId)}/parser-runs`),
      ],
    ];

    const forgedJwt = () =>
      [randomBytes(12), randomBytes(24), randomBytes(32)]
        .map((part) => part.toString('base64url'))
        .join('.');

    let before: unknown;

    beforeAll(async () => {
      before = {
        connection: await connectionSnapshot(aliceConn),
        rule: await ruleSnapshot(aliceRuleId),
        message: await messageSnapshot(aliceMessageId),
        counts: await alicePipelineCounts(),
      };
    });

    it.each(protectedRoutes)(
      'unauthenticated %s gets 401 (no session, forged cookie, forged bearer)',
      async (_name, send) => {
        const none = await send(http());
        const cookie = await send(http()).set(
          'Cookie',
          `accessToken=${forgedJwt()}`,
        );
        const bearer = await send(http()).set(
          'Authorization',
          `Bearer ${forgedJwt()}`,
        );
        expect({
          none: none.status,
          cookie: cookie.status,
          bearer: bearer.status,
        }).toEqual({ none: 401, cookie: 401, bearer: 401 });
        expect([...leaks(none), ...leaks(cookie), ...leaks(bearer)]).toEqual(
          [],
        );
        expect(googleCalls()).toBe(0);
      },
    );

    it('unauthenticated attempts changed none of alice’s rows', async () => {
      expect({
        connection: await connectionSnapshot(aliceConn),
        rule: await ruleSnapshot(aliceRuleId),
        message: await messageSnapshot(aliceMessageId),
        counts: await alicePipelineCounts(),
      }).toEqual(before);
    });
  });

  // -------------------------------- non-owners (USER and ADMIN) on alice's rows

  describe.each([
    ['USER bob', 'bob'],
    ['ADMIN (no bypass, SEC-008)', 'admin'],
  ] as Array<[string, ActorKey]>)(
    '%s on alice’s email pipeline',
    (who, key) => {
      describe('email connections', () => {
        it(`${who} sees only their own connections in GET /email-connections`, async () => {
          const { user, connection } = actor(key);
          const res = await user.agent
            .get('/api/email-connections')
            .expect(200);
          const ids = dataOf<Array<{ id: string }>>(res).map((row) => row.id);
          expect(ids).toContain(connection.id);
          expect(ids).not.toContain(aliceConn.id);
          expect(ids).not.toContain(aliceSpare.id);
          const owners = await prisma.emailConnection.findMany({
            where: { id: { in: ids } },
            select: { userId: true },
          });
          expect(owners.every((row) => row.userId === user.id)).toBe(true);
          expect(leaks(res)).toEqual([]);
          expect(disclosedAliceData(res)).toEqual([]);
        });

        it(`${who} gets 404 on DELETE /email-connections/:id for alice’s connection, which stays connected with its tokens`, async () => {
          const { user } = actor(key);
          const before = await connectionSnapshot(aliceConn);
          const absent = await user.agent.delete(
            `/api/email-connections/${absentId()}`,
          );
          const res = await user.agent.delete(
            `/api/email-connections/${idPath(aliceConn.id)}`,
          );
          expectOwnerSafeNotFound(res, absent);
          const after = await connectionSnapshot(aliceConn);
          expect(after).toEqual(before);
          expect(after).toMatchObject({
            status: 'ACTIVE',
            disconnectedAt: null,
            tokensIntact: true,
          });
        });

        it(`${who} gets 404 on POST /email-connections/:id/sync for alice’s connection; no sync run is created and Gmail is never called`, async () => {
          const { user } = actor(key);
          const before = {
            connection: await connectionSnapshot(aliceConn),
            counts: await alicePipelineCounts(),
          };
          const absent = await user.agent.post(
            `/api/email-connections/${absentId()}/sync`,
          );
          const res = await user.agent.post(
            `/api/email-connections/${idPath(aliceConn.id)}/sync`,
          );
          expectOwnerSafeNotFound(res, absent);
          expect({
            connection: await connectionSnapshot(aliceConn),
            counts: await alicePipelineCounts(),
          }).toEqual(before);
          expect(googleCalls()).toBe(0);
        });

        it(`${who} gets 404 on GET /email-connections/:id/sync-runs for alice’s connection`, async () => {
          const { user } = actor(key);
          const absent = await user.agent.get(
            `/api/email-connections/${absentId()}/sync-runs`,
          );
          const res = await user.agent.get(
            `/api/email-connections/${idPath(aliceConn.id)}/sync-runs`,
          );
          expectOwnerSafeNotFound(res, absent);
          expect(res.text.includes(aliceSyncRunId)).toBe(false);
        });
      });

      describe('listen rules', () => {
        it(`${who} sees only their own rules in GET /email-listen-rules`, async () => {
          const { user, ruleId } = actor(key);
          const res = await user.agent
            .get('/api/email-listen-rules')
            .expect(200);
          const ids = dataOf<Array<{ id: string }>>(res).map((row) => row.id);
          expect(ids).toContain(ruleId);
          expect(ids).not.toContain(aliceRuleId);
          const owners = await prisma.emailListenRule.findMany({
            where: { id: { in: ids } },
            select: { userId: true },
          });
          expect(owners.every((row) => row.userId === user.id)).toBe(true);
          expect(disclosedAliceData(res)).toEqual([]);
        });

        it(`${who} gets 404 on PATCH /email-listen-rules/:id for alice’s rule, which stays unchanged`, async () => {
          const { user } = actor(key);
          const before = await ruleSnapshot(aliceRuleId);
          const body = {
            name: 'T016 hijacked rule',
            isEnabled: false,
            senderEmail: syntheticEmail('t016-hijack-sender'),
          };
          const absent = await user.agent
            .patch(`/api/email-listen-rules/${absentId()}`)
            .send(body);
          const res = await user.agent
            .patch(`/api/email-listen-rules/${idPath(aliceRuleId)}`)
            .send(body);
          expectOwnerSafeNotFound(res, absent);
          expect(await ruleSnapshot(aliceRuleId)).toEqual(before);
        });

        it(`${who} gets 404 on DELETE /email-listen-rules/:id for alice’s rule, which still exists`, async () => {
          const { user } = actor(key);
          const before = await ruleSnapshot(aliceRuleId);
          const absent = await user.agent.delete(
            `/api/email-listen-rules/${absentId()}`,
          );
          const res = await user.agent.delete(
            `/api/email-listen-rules/${idPath(aliceRuleId)}`,
          );
          expectOwnerSafeNotFound(res, absent);
          const after = await ruleSnapshot(aliceRuleId);
          expect(after).not.toBeNull();
          expect(after).toEqual(before);
        });

        it(`${who} gets 404 on POST /email-listen-rules that links alice’s connection, and no rule is created`, async () => {
          const { user } = actor(key);
          const before = {
            callerRules: await prisma.emailListenRule.count({
              where: { userId: user.id },
            }),
            counts: await alicePipelineCounts(),
          };
          const body = (emailConnectionId: string) => ({
            name: 'T016 cross-user link',
            emailConnectionId,
            senderEmail: syntheticEmail('t016-link-sender'),
          });
          const absent = await user.agent
            .post('/api/email-listen-rules')
            .send(body(absentId()));
          const res = await user.agent
            .post('/api/email-listen-rules')
            .send(body(aliceConn.id));
          expectOwnerSafeNotFound(res, absent);
          expect({
            callerRules: await prisma.emailListenRule.count({
              where: { userId: user.id },
            }),
            counts: await alicePipelineCounts(),
          }).toEqual(before);
        });

        it(`${who} gets 404 on PATCH of their own rule that re-links it to alice’s connection, and their rule stays unchanged`, async () => {
          const { user, ruleId } = actor(key);
          const before = await ruleSnapshot(ruleId);
          const absent = await user.agent
            .patch(`/api/email-listen-rules/${idPath(ruleId)}`)
            .send({ emailConnectionId: absentId() });
          const res = await user.agent
            .patch(`/api/email-listen-rules/${idPath(ruleId)}`)
            .send({ emailConnectionId: aliceConn.id });
          expectOwnerSafeNotFound(res, absent);
          expect(await ruleSnapshot(ruleId)).toEqual(before);
        });

        it(`${who} gets 400 on POST /email-listen-rules whose body names alice as userId, and nothing is created`, async () => {
          const { user } = actor(key);
          const before = {
            callerRules: await prisma.emailListenRule.count({
              where: { userId: user.id },
            }),
            aliceRules: await prisma.emailListenRule.count({
              where: { userId: alice.id },
            }),
          };
          const res = await user.agent.post('/api/email-listen-rules').send({
            name: 'T016 mass assignment',
            userId: alice.id,
            senderEmail: syntheticEmail('t016-mass-sender'),
          });
          expect(res.status).toBe(400);
          expect({
            callerRules: await prisma.emailListenRule.count({
              where: { userId: user.id },
            }),
            aliceRules: await prisma.emailListenRule.count({
              where: { userId: alice.id },
            }),
          }).toEqual(before);
        });
      });

      describe('email messages and parser runs', () => {
        it(`${who} sees only their own messages in GET /email-messages`, async () => {
          const { user, messageId } = actor(key);
          const res = await user.agent
            .get('/api/email-messages')
            .query({ limit: 100 })
            .expect(200);
          const ids = dataOf<{ data: Array<{ id: string }> }>(res).data.map(
            (row) => row.id,
          );
          expect(ids).toContain(messageId);
          expect(ids).not.toContain(aliceMessageId);
          const owners = await prisma.emailMessage.findMany({
            where: { id: { in: ids } },
            select: { userId: true },
          });
          expect(owners.every((row) => row.userId === user.id)).toBe(true);
          expect(leaks(res)).toEqual([]);
          expect(disclosedAliceData(res)).toEqual([]);
        });

        it(`${who} gets 404 on GET /email-messages?emailConnectionId= for alice’s connection`, async () => {
          const { user } = actor(key);
          const absent = await user.agent
            .get('/api/email-messages')
            .query({ emailConnectionId: absentId() });
          const res = await user.agent
            .get('/api/email-messages')
            .query({ emailConnectionId: aliceConn.id });
          expectOwnerSafeNotFound(res, absent);
        });

        it(`${who} gets 404 on POST /email-messages/:id/parse for alice’s message; no parser run or transaction is created`, async () => {
          const { user } = actor(key);
          const before = {
            message: await messageSnapshot(aliceMessageId),
            counts: await alicePipelineCounts(),
            callerTransactions: await prisma.transaction.count({
              where: { userId: user.id },
            }),
          };
          const absent = await user.agent.post(
            `/api/email-messages/${absentId()}/parse`,
          );
          const res = await user.agent.post(
            `/api/email-messages/${idPath(aliceMessageId)}/parse`,
          );
          expectOwnerSafeNotFound(res, absent);
          expect({
            message: await messageSnapshot(aliceMessageId),
            counts: await alicePipelineCounts(),
            callerTransactions: await prisma.transaction.count({
              where: { userId: user.id },
            }),
          }).toEqual(before);
        });

        it(`${who} gets 404 on GET /email-messages/:id/parser-runs for alice’s message`, async () => {
          const { user } = actor(key);
          const absent = await user.agent.get(
            `/api/email-messages/${absentId()}/parser-runs`,
          );
          const res = await user.agent.get(
            `/api/email-messages/${idPath(aliceMessageId)}/parser-runs`,
          );
          expectOwnerSafeNotFound(res, absent);
          expect(res.text.includes(aliceParserRunId)).toBe(false);
        });
      });
    },
  );

  // ---------------------------------------------- malformed and absent ids

  describe('malformed and absent identifiers (SEC-007)', () => {
    const idRoutes: IdRoute[] = [
      [
        'DELETE /email-connections/:id',
        (c, id) => c.delete(`/api/email-connections/${idPath(id)}`),
      ],
      [
        'POST /email-connections/:id/sync',
        (c, id) => c.post(`/api/email-connections/${idPath(id)}/sync`),
      ],
      [
        'GET /email-connections/:id/sync-runs',
        (c, id) => c.get(`/api/email-connections/${idPath(id)}/sync-runs`),
      ],
      [
        'GET /email-messages?emailConnectionId=:id',
        (c, id) =>
          c.get('/api/email-messages').query({ emailConnectionId: id }),
      ],
      [
        'PATCH /email-listen-rules/:id',
        (c, id) =>
          c
            .patch(`/api/email-listen-rules/${idPath(id)}`)
            .send({ name: 'T016 malformed-id probe' }),
      ],
      [
        'DELETE /email-listen-rules/:id',
        (c, id) => c.delete(`/api/email-listen-rules/${idPath(id)}`),
      ],
      [
        'POST /email-messages/:id/parse',
        (c, id) => c.post(`/api/email-messages/${idPath(id)}/parse`),
      ],
      [
        'GET /email-messages/:id/parser-runs',
        (c, id) => c.get(`/api/email-messages/${idPath(id)}/parser-runs`),
      ],
    ];

    const describeId = (id: string, index: number) =>
      `#${index} ${id.length > 40 ? `${id.slice(0, 8)}...(${id.length} chars)` : JSON.stringify(id)}`;

    it.each(idRoutes)(
      'USER gets 404 (never 500) on %s for every malformed or absent id',
      async (_name, send) => {
        const ids = [...MALFORMED_IDS, absentId()];
        const statuses: Record<string, number> = {};
        for (const [index, id] of ids.entries()) {
          statuses[describeId(id, index)] = (await send(bob.agent, id)).status;
        }
        expect(statuses).toEqual(
          Object.fromEntries(Object.keys(statuses).map((k) => [k, 404])),
        );
      },
    );

    it('USER gets 404, not 500, on every id route when the id contains a NUL byte', async () => {
      const id = `\u0000t016${randomBytes(4).toString('hex')}`;
      const statuses: Record<string, number> = {};
      for (const [name, send] of idRoutes) {
        statuses[name] = (await send(bob.agent, id)).status;
      }
      expect(statuses).toEqual(
        Object.fromEntries(idRoutes.map(([name]) => [name, 404])),
      );
    });
  });

  // ------------------------------------- Gmail OAuth callback account linking

  describe('Gmail OAuth callback account linking (SEC-001: the state must be bound to the browser that started the flow)', () => {
    it('a callback with bob’s state completed by a cookieless client (not the browser that started the flow) is refused and links nothing to bob', async () => {
      const state = await startConnect(bob.agent);
      const before = await connectionsOf(bob.id);
      const { inbox } = stubGoogleConsent('cookieless');

      const res = await completeCallback(http(), state);

      expect(refusal(res)).toBe('refused');
      expect(
        await prisma.emailConnection.count({ where: { emailAddress: inbox } }),
      ).toBe(0);
      expect(await connectionsOf(bob.id)).toEqual(before);
      expect(leaks(res)).toEqual([]);
    });

    it('a callback with bob’s state completed in alice’s signed-in browser is refused and links the inbox to nobody', async () => {
      const state = await startConnect(bob.agent);
      const before = {
        bob: await connectionsOf(bob.id),
        alice: await connectionsOf(alice.id),
      };
      const { inbox } = stubGoogleConsent('victim-browser');

      const res = await completeCallback(alice.agent, state);

      expect(refusal(res)).toBe('refused');
      expect(
        await prisma.emailConnection.count({ where: { emailAddress: inbox } }),
      ).toBe(0);
      expect({
        bob: await connectionsOf(bob.id),
        alice: await connectionsOf(alice.id),
      }).toEqual(before);
      expect(leaks(res)).toEqual([]);
    });

    it('the browser that started the flow (bob’s agent) completes it and the inbox is linked to bob only, with tokens stored encrypted', async () => {
      const state = await startConnect(bob.agent);
      const { inbox, accessPlain } = stubGoogleConsent('same-browser');

      const res = await completeCallback(bob.agent, state);

      expect(acceptance(res)).toBe('accepted');
      const linked = await prisma.emailConnection.findMany({
        where: { emailAddress: inbox },
      });
      expect(linked.map((row) => row.userId)).toEqual([bob.id]);
      expect(linked[0].accessTokenEncrypted.includes(accessPlain)).toBe(false);
      expect(leaks(res)).toEqual([]);
    });

    it('a state whose payload was altered to name alice is refused and links nothing', async () => {
      const state = await startConnect(bob.agent);
      const [payload, signature] = state.split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const forged = `${Buffer.from(
        JSON.stringify({ ...claims, sub: alice.id }),
      ).toString('base64url')}.${signature}`;
      const before = await connectionsOf(alice.id);
      const { inbox } = stubGoogleConsent('forged-state');

      const res = await completeCallback(alice.agent, forged);

      expect(refusal(res)).toBe('refused');
      expect(
        await prisma.emailConnection.count({ where: { emailAddress: inbox } }),
      ).toBe(0);
      expect(await connectionsOf(alice.id)).toEqual(before);
    });

    it('a callback without a state is refused with 4xx (unauthorized outcome), never 500', async () => {
      const { inbox } = stubGoogleConsent('missing-state');

      const res = await completeCallback(bob.agent, undefined);

      expect(refusal(res)).toBe('refused');
      expect(
        await prisma.emailConnection.count({ where: { emailAddress: inbox } }),
      ).toBe(0);
    });

    it.each([
      ['DISABLED', { status: 'DISABLED' as const }],
      ['PENDING_DELETE', { status: 'PENDING_DELETE' as const }],
      ['soft-deleted', { deletedAt: new Date() }],
    ])(
      'a flow started by an account that is then %s cannot link an inbox, even from the same browser',
      async (label, change) => {
        const user = await registerUser(
          app,
          `t016-oauth-${label.toLowerCase()}`,
        );
        extraUserIds.push(user.id);
        const state = await startConnect(user.agent);
        await prisma.user.update({ where: { id: user.id }, data: change });
        const { inbox } = stubGoogleConsent(`account-${label}`);

        const res = await completeCallback(user.agent, state);

        expect(refusal(res)).toBe('refused');
        expect(
          await prisma.emailConnection.count({
            where: { emailAddress: inbox },
          }),
        ).toBe(0);
        expect(await connectionsOf(user.id)).toEqual([]);
      },
    );
  });

  // ------------------------------------------- the owner: no token disclosure

  describe('alice (the owner) sees her pipeline without provider tokens or raw bodies', () => {
    it('GET /email-connections lists both of alice’s connections without token fields or values', async () => {
      const res = await alice.agent.get('/api/email-connections').expect(200);
      const rows = dataOf<Array<{ id: string; status: string }>>(res);
      expect(rows.map((row) => row.id)).toEqual(
        expect.arrayContaining([aliceConn.id, aliceSpare.id]),
      );
      expect(leaks(res)).toEqual([]);
    });

    it('listen-rule create and list responses carry no token fields or values', async () => {
      const res = await alice.agent.get('/api/email-listen-rules').expect(200);
      expect(dataOf<Array<{ id: string }>>(res).map((row) => row.id)).toContain(
        aliceRuleId,
      );
      expect([...leaks(aliceRuleCreated), ...leaks(res)]).toEqual([]);
    });

    it('GET /email-connections/:id/sync-runs returns alice’s run without token fields or values', async () => {
      const res = await alice.agent
        .get(`/api/email-connections/${idPath(aliceConn.id)}/sync-runs`)
        .expect(200);
      expect(dataOf<Array<{ id: string }>>(res).map((row) => row.id)).toContain(
        aliceSyncRunId,
      );
      expect(leaks(res)).toEqual([]);
    });

    it('GET /email-messages (with and without the connection filter) returns alice’s message without token fields or values', async () => {
      const all = await alice.agent
        .get('/api/email-messages')
        .query({ limit: 100 })
        .expect(200);
      const filtered = await alice.agent
        .get('/api/email-messages')
        .query({ emailConnectionId: aliceConn.id, limit: 100 })
        .expect(200);
      for (const res of [all, filtered]) {
        expect(
          dataOf<{ data: Array<{ id: string }> }>(res).data.map((m) => m.id),
        ).toContain(aliceMessageId);
      }
      expect([...leaks(all), ...leaks(filtered)]).toEqual([]);
    });

    it('GET /email-messages/:id/parser-runs returns alice’s parser run without token fields or values', async () => {
      const res = await alice.agent
        .get(`/api/email-messages/${idPath(aliceMessageId)}/parser-runs`)
        .expect(200);
      expect(dataOf<Array<{ id: string }>>(res).map((row) => row.id)).toContain(
        aliceParserRunId,
      );
      expect(leaks(res)).toEqual([]);
    });

    it('POST /email-connections/:id/sync (Gmail stubbed) records a run for alice; neither the run, the stored message, the message list nor its parser runs expose tokens or the raw body', async () => {
      const gmailId = `t016-gmail-${RUN_ID}-${randomBytes(4).toString('hex')}`;
      const message: GmailMessage = {
        id: gmailId,
        threadId: `t016-thread-${RUN_ID}`,
        historyId: '1',
        internalDate: String(Date.now()),
        snippet: 'T016 synced snippet',
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: `T016 Bank <${aliceSender}>` },
            { name: 'Subject', value: 'T016 synced notification' },
            {
              name: 'Message-ID',
              value: `<${syntheticEmail('t016-message-id')}>`,
            },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              body: {
                data: Buffer.from(`Statement ${BODY_MARKER}`).toString(
                  'base64url',
                ),
              },
            },
          ],
        },
      };
      listIdsSpy.mockResolvedValue([gmailId]);
      getMessageSpy.mockResolvedValue(message);
      const runsBefore = await prisma.emailSyncRun.count({
        where: { emailConnectionId: aliceConn.id },
      });

      const res = await alice.agent.post(
        `/api/email-connections/${idPath(aliceConn.id)}/sync`,
      );

      expect([200, 201]).toContain(res.status);
      expect(leaks(res)).toEqual([]);
      expect(
        await prisma.emailSyncRun.count({
          where: { emailConnectionId: aliceConn.id },
        }),
      ).toBe(runsBefore + 1);
      // The stored fixture token was decrypted for the owner's own sync.
      expect(listIdsSpy.mock.calls.length).toBe(1);
      expect(listIdsSpy.mock.calls[0][0] === aliceConn.accessPlain).toBe(true);

      const stored = await prisma.emailMessage.findUnique({
        where: {
          emailConnectionId_providerMessageId: {
            emailConnectionId: aliceConn.id,
            providerMessageId: gmailId,
          },
        },
      });
      expect(stored?.userId).toBe(alice.id);
      expect(JSON.stringify(stored).includes(BODY_MARKER)).toBe(false);

      const list = await alice.agent
        .get('/api/email-messages')
        .query({ emailConnectionId: aliceConn.id, limit: 100 })
        .expect(200);
      expect(
        dataOf<{ data: Array<{ id: string }> }>(list).data.map((m) => m.id),
      ).toContain(stored?.id);
      const runs = await alice.agent
        .get(`/api/email-messages/${idPath(stored?.id ?? '')}/parser-runs`)
        .expect(200);
      expect([...leaks(list), ...leaks(runs)]).toEqual([]);
    });

    it('POST /email-messages/:id/parse lets alice parse her own message and records a parser run without exposing tokens', async () => {
      const before = await prisma.parserRun.count({
        where: { emailMessageId: aliceMessageId },
      });
      const res = await alice.agent.post(
        `/api/email-messages/${idPath(aliceMessageId)}/parse`,
      );
      expect([200, 201]).toContain(res.status);
      expect(
        await prisma.parserRun.count({
          where: { emailMessageId: aliceMessageId },
        }),
      ).toBe(before + 1);
      expect(leaks(res)).toEqual([]);
    });

    it('DELETE /email-connections/:id lets alice disconnect her own spare connection', async () => {
      const res = await alice.agent.delete(
        `/api/email-connections/${idPath(aliceSpare.id)}`,
      );
      expect([200, 204]).toContain(res.status);
      expect(leaks(res)).toEqual([]);
      const after = await connectionSnapshot(aliceSpare);
      expect(after?.disconnectedAt).not.toBeNull();
      expect(after?.tokensIntact).toBe(false);
    });
  });
});
