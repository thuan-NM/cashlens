import { createTestApp } from './helpers/test-app'; // first: seeds synthetic config
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import request from 'supertest';
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
import {
  RUN_ID,
  TestUser,
  cleanupUsers,
  dataOf,
  idPath,
  promoteToAdminForTest,
  registerUser,
  syntheticEmail,
} from './helpers/auth-fixtures';
import {
  createListenRule,
  createParserTemplate,
  gmailMessage,
} from './helpers/email-fixtures';
import {
  DECLARATION_FILE,
  EmailFixture,
  loadFixtures,
  readDeclarations,
  repoPath,
} from './helpers/parser-gate';

jest.setTimeout(120_000);

/** Replays of an unchanged mailbox (SC-004); assertions run after each one. */
const REPLAYS = 3;

const DECLARED = readDeclarations(readFileSync(DECLARATION_FILE, 'utf8'))[0];
const FIXTURES = loadFixtures(DECLARED.fixtures);
const TEMPLATE = JSON.parse(
  readFileSync(repoPath(DECLARED.template), 'utf8'),
) as { name: string };
const SENDER = 'notify@vcb.example.test';
const SYNC_RUN_KEYS = [
  'createdAt',
  'emailConnectionId',
  'emailsFailed',
  'emailsFound',
  'emailsMatched',
  'emailsParsed',
  'errorMessage',
  'finishedAt',
  'hasMore',
  'id',
  'startedAt',
  'status',
  'transactionsCreated',
  'triggerType',
];

type SyncRun = {
  id: string;
  status: string;
  emailsFound: number;
  emailsMatched: number;
  emailsParsed: number;
  emailsFailed: number;
  transactionsCreated: number;
  hasMore: boolean;
  errorMessage: string | null;
};
type Mailbox = Map<string, EmailFixture | 'OTHER_SENDER'>;

const valid = (name: string) =>
  FIXTURES.valid.find((fixture) => fixture.file.includes(name))!;
const malformed = (name: string) =>
  FIXTURES.malformed.find((fixture) => fixture.file.includes(name))!;

/** The same code on another event: a credit that reverses the debit. */
const reversalOf = (fixture: EmailFixture): EmailFixture => ({
  ...fixture,
  file: `${fixture.file} (reversal)`,
  message: {
    ...fixture.message,
    body: fixture.message.body.map((line) =>
      line.startsWith('Loại giao dịch:')
        ? 'Loại giao dịch: Ghi có'
        : line.startsWith('Số tiền:')
          ? line.replace('-', '+')
          : line,
    ),
  },
});

/** The same bank event reported again by another message (a resend). */
const resendOf = (fixture: EmailFixture): EmailFixture => ({
  ...fixture,
  file: `${fixture.file} (resend)`,
  message: {
    ...fixture.message,
    subject: `${fixture.message.subject} (gửi lại)`,
    receivedAt: new Date(
      new Date(fixture.message.receivedAt).getTime() + 5 * 60_000,
    ).toISOString(),
  },
});

// T049 (EMAIL-001–EMAIL-013, ERR-003, TEST-004, TEST-005, SC-004): the manual
// Gmail pipeline end to end with a synthetic mailbox — OAuth to transaction,
// replays, concurrency, partial failure, continuation, stale leases, and
// disconnect/reconnect — with no duplicate active transaction at any point.
describe('Gmail ingestion pipeline (T049)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let admin: TestUser;
  let templateId: string;
  let connectionId: string;
  const mailbox: Mailbox = new Map();
  const mailboxAddress = syntheticEmail('t049-mailbox');
  const secrets: string[] = [];
  let listSpy: jest.SpiedFunction<GmailApiService['listMessageIds']>;
  let getSpy: jest.SpiedFunction<GmailApiService['getMessage']>;
  let exchangeSpy: jest.SpiedFunction<GmailOAuthService['exchangeCode']>;
  let refreshSpy: jest.SpiedFunction<GmailOAuthService['refreshAccessToken']>;

  const providerId = (label: string) => `t049-${RUN_ID}-${label}`;
  const syncPath = () => `/api/email-connections/${idPath(connectionId)}/sync`;

  /** Gmail's messages.get for the synthetic mailbox. */
  const serve = (_token: string, id: string) => {
    const fixture = mailbox.get(id);
    if (!fixture) return Promise.reject(new GmailApiError('NOT_FOUND', 404));
    if (fixture === 'OTHER_SENDER') {
      return Promise.resolve(
        gmailMessage({
          id,
          from: 'Newsletter <news@shop.example.test>',
          subject: 'Khuyến mãi tháng 9',
          body: 'Số tiền: -1,000 VND',
          receivedAt: new Date(),
        }),
      );
    }
    return Promise.resolve(
      gmailMessage({
        id,
        from: fixture.message.from,
        subject: fixture.message.subject,
        receivedAt: new Date(fixture.message.receivedAt),
        body: fixture.message.body.join('\n'),
      }),
    );
  };
  const serveMailbox = () => {
    listSpy.mockImplementation(() =>
      Promise.resolve({ ids: [...mailbox.keys()] }),
    );
    getSpy.mockImplementation(serve);
  };

  const sync = async (expected = 201) => {
    const response = await alice.agent.post(syncPath()).expect(expected);
    expect(JSON.stringify(response.body)).not.toMatch(
      new RegExp(
        secrets.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      ),
    );
    return response;
  };
  const runOf = (response: request.Response) => dataOf<SyncRun>(response);

  const transactionsOf = () =>
    prisma.transaction.findMany({
      where: { userId: alice.id },
      orderBy: { transactionTime: 'asc' },
    });

  /** No event is represented by two active transactions (EMAIL-007). */
  const expectNoDuplicateActive = async () => {
    const active = await prisma.transaction.findMany({
      where: { userId: alice.id, status: 'POSTED', isDuplicate: false },
      select: { deduplicationFingerprint: true, transactionCode: true },
    });
    const keys = active.map((t) => t.deduplicationFingerprint);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    const codes = active.map((t) => t.transactionCode).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  };

  async function completeOAuth(accessToken: string, refreshToken: string) {
    secrets.push(accessToken, refreshToken);
    exchangeSpy.mockResolvedValueOnce({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      token_type: 'Bearer',
    });
    const connect = await alice.agent
      .post('/api/email-connections/gmail/connect')
      .expect(201);
    const authorizationUrl = new URL(
      dataOf<{ authorizationUrl: string }>(connect).authorizationUrl,
    );
    expect(authorizationUrl.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/gmail.readonly',
    );
    await alice.agent
      .get('/api/email-connections/gmail/callback')
      .query({
        state: authorizationUrl.searchParams.get('state'),
        code: randomBytes(16).toString('base64url'),
      })
      .expect(200);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 't049-alice');
    admin = await registerUser(app, 't049-admin');
    await promoteToAdminForTest(prisma, admin.id);
    await admin.agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);

    const oauth = app.get(GmailOAuthService);
    const gmail = app.get(GmailApiService);
    exchangeSpy = jest.spyOn(oauth, 'exchangeCode');
    refreshSpy = jest
      .spyOn(oauth, 'refreshAccessToken')
      .mockRejectedValue(new Error('T049: no token refresh expected'));
    jest.spyOn(oauth, 'profile').mockResolvedValue({
      emailAddress: mailboxAddress,
      messagesTotal: 0,
      threadsTotal: 0,
      historyId: '1',
    });
    jest.spyOn(oauth, 'revokeToken').mockResolvedValue(true);
    listSpy = jest.spyOn(gmail, 'listMessageIds');
    getSpy = jest.spyOn(gmail, 'getMessage');
    serveMailbox();

    await prisma.parserTemplate.deleteMany({
      where: { bankProviderId: DECLARED.bank, name: TEMPLATE.name },
    });
    templateId = await createParserTemplate(admin.agent, TEMPLATE);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) {
      await cleanupUsers(prisma, [alice?.id, admin?.id]);
      if (templateId) {
        await prisma.parserTemplate.deleteMany({ where: { id: templateId } });
      }
    }
    await app?.close();
  });

  it('OAuth to transaction: valid, non-matching, malformed, and resent messages', async () => {
    await completeOAuth(
      randomBytes(32).toString('base64url'),
      randomBytes(32).toString('base64url'),
    );
    const connections = dataOf<
      Array<{ id: string; status: string; recoveryAction: string }>
    >(await alice.agent.get('/api/email-connections').expect(200));
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      status: 'ACTIVE',
      recoveryAction: 'NONE',
    });
    expect(JSON.stringify(connections)).not.toMatch(
      /Encrypted|syncCursor|syncLeaseToken/,
    );
    connectionId = connections[0].id;
    await createListenRule(alice.agent, {
      connectionId,
      senderEmail: SENDER,
      bankProviderId: DECLARED.bank,
    });

    mailbox.set(providerId('qr'), valid('01-'));
    mailbox.set(providerId('salary'), valid('02-'));
    mailbox.set(providerId('atm'), valid('05-')); // no code: fingerprint
    mailbox.set(providerId('promo'), 'OTHER_SENDER');
    mailbox.set(providerId('zero'), malformed('m01-'));
    mailbox.set(providerId('qr-resend'), resendOf(valid('01-')));
    mailbox.set(providerId('atm-resend'), resendOf(valid('05-')));
    mailbox.set(providerId('qr-reversal'), reversalOf(valid('01-')));

    const run = runOf(await sync());
    expect(Object.keys(run).sort()).toEqual(SYNC_RUN_KEYS);
    expect(run).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsFound: 8,
      emailsMatched: 7,
      emailsParsed: 6,
      emailsFailed: 1,
      transactionsCreated: 5,
      hasMore: false,
      errorMessage: '1 message(s) failed',
    });

    const messageOf = (label: string) =>
      prisma.emailMessage.findUniqueOrThrow({
        where: {
          emailConnectionId_providerMessageId: {
            emailConnectionId: connectionId,
            providerMessageId: providerId(label),
          },
        },
        include: { parserRuns: true, transaction: true },
      });
    const transactions = await transactionsOf();
    // One active transaction per event (EMAIL-007).
    expect(
      transactions
        .filter((t) => !t.isDuplicate)
        .map((t) => [t.transactionCode, t.deduplicationStrategy]),
    ).toEqual([
      ['FT26171ABC12', 'TRANSACTION_CODE'],
      ['FT26181SAL001', 'TRANSACTION_CODE'],
      [null, 'FINGERPRINT'],
    ]);
    // A certain duplicate (same code, same facts) creates nothing and is
    // explained by its parser run (EMAIL-008).
    const qr = await messageOf('qr');
    const qrResend = await messageOf('qr-resend');
    expect(qrResend.transaction).toBeNull();
    expect(qrResend.processingStatus).toBe('PARSED');
    expect(qrResend.parserRuns[0]).toMatchObject({
      status: 'SUCCESS',
      createdTransactionId: null,
      normalizedPayload: {
        deduplication: {
          strategy: 'TRANSACTION_CODE',
          outcome: 'DUPLICATE',
          duplicateOfTransactionId: qr.transaction!.id,
          sameFacts: { amount: true, direction: true, currency: true },
        },
      },
    });
    // A suspected duplicate is kept, flagged, excluded from totals, and
    // reversible: a fingerprint match, or a code reused with other facts.
    const atm = await messageOf('atm');
    for (const [label, original, sameFacts] of [
      ['atm-resend', atm, { amount: true, direction: true, currency: true }],
      ['qr-reversal', qr, { amount: true, direction: false, currency: true }],
    ] as const) {
      const message = await messageOf(label);
      expect(message.transaction).toMatchObject({
        isDuplicate: true,
        duplicateOfTransactionId: original.transaction!.id,
        deduplicationFingerprint: null,
        status: 'POSTED',
      });
      expect(message.parserRuns[0]).toMatchObject({
        status: 'SUCCESS',
        createdTransactionId: message.transaction!.id,
        normalizedPayload: {
          deduplication: {
            outcome: 'SUSPECTED_DUPLICATE',
            duplicateOfTransactionId: original.transaction!.id,
            sameFacts,
          },
        },
      });
    }
    expect((await messageOf('qr-reversal')).transaction!.direction).toBe(
      'INCOME',
    );
    // The malformed message is observable and posted nothing (EMAIL-011).
    const zero = await messageOf('zero');
    expect(zero).toMatchObject({
      processingStatus: 'FAILED',
      transaction: null,
    });
    expect(zero.parserRuns[0]).toMatchObject({
      status: 'FAILED',
      errorMessage: 'INVALID_AMOUNT: amount',
      extractedPayload: {},
    });
    // The non-matching message was never stored.
    expect(
      await prisma.emailMessage.count({
        where: {
          emailConnectionId: connectionId,
          providerMessageId: providerId('promo'),
        },
      }),
    ).toBe(0);
    await expectNoDuplicateActive();
  });

  it(`replaying the unchanged mailbox ${REPLAYS} times changes nothing`, async () => {
    const before = {
      transactions: await transactionsOf(),
      parserRuns: await prisma.parserRun.count({
        where: { emailMessage: { userId: alice.id } },
      }),
      messages: await prisma.emailMessage.count({
        where: { userId: alice.id },
      }),
    };
    for (let replay = 1; replay <= REPLAYS; replay++) {
      const run = runOf(await sync());
      expect([replay, run]).toEqual([
        replay,
        expect.objectContaining({
          status: 'SUCCESS',
          transactionsCreated: 0,
          emailsParsed: 0,
          emailsFailed: 0,
          hasMore: false,
        }),
      ]);
      expect(await transactionsOf()).toEqual(before.transactions);
      expect(
        await prisma.parserRun.count({
          where: { emailMessage: { userId: alice.id } },
        }),
      ).toBe(before.parserRuns);
      expect(
        await prisma.emailMessage.count({ where: { userId: alice.id } }),
      ).toBe(before.messages);
      await expectNoDuplicateActive();
    }
  });

  it('concurrent syncs: exactly one takes the lease, the other gets 409 and records nothing', async () => {
    const runsBefore = await prisma.emailSyncRun.count({
      where: { emailConnectionId: connectionId },
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    listSpy.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { ids: [...mailbox.keys()] };
    });

    const first = alice.agent.post(syncPath()).then((response) => response);
    await inside; // the first run holds the lease and is mid-listing
    const second = await alice.agent.post(syncPath());
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      statusCode: 409,
      code: 'SYNC_IN_PROGRESS',
    });
    const connection = dataOf<Array<{ syncInProgress: boolean }>>(
      await alice.agent.get('/api/email-connections').expect(200),
    )[0];
    expect(connection.syncInProgress).toBe(true);

    release();
    expect((await first).status).toBe(201);
    expect(
      await prisma.emailSyncRun.count({
        where: { emailConnectionId: connectionId },
      }),
    ).toBe(runsBefore + 1);
    await expectNoDuplicateActive();
  });

  it('a transient failure is a partial run; the next sync finishes the page without duplicates', async () => {
    mailbox.set(providerId('coffee'), valid('03-'));
    mailbox.set(providerId('grab'), valid('04-'));
    const failing = providerId('grab');
    getSpy.mockImplementation(async (token, id) => {
      if (id === failing) throw new GmailApiError('TRANSIENT', 503);
      return serve(token, id);
    });
    const partial = runOf(await sync());
    expect(partial).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsFailed: 1,
      hasMore: true,
    });

    serveMailbox();
    const next = runOf(await sync());
    expect(next).toMatchObject({
      status: 'SUCCESS',
      emailsFailed: 0,
      hasMore: false,
    });
    const codes = (await transactionsOf()).map((t) => t.transactionCode);
    expect(codes.filter((code) => code === 'FT26182CF01')).toHaveLength(1);
    expect(codes.filter((code) => code === 'FT26183GRB')).toHaveLength(1);
    await expectNoDuplicateActive();
  });

  it('continuation: a bounded page reports more work and the next sync continues from its page token', async () => {
    const pageTwo = providerId('midnight');
    mailbox.set(pageTwo, valid('07-'));
    const pageOne = [...mailbox.keys()].filter((id) => id !== pageTwo);
    listSpy.mockImplementation((_token, _query, options) =>
      Promise.resolve(
        options?.pageToken === 'page-2'
          ? { ids: [pageTwo] }
          : { ids: pageOne, nextPageToken: 'page-2' },
      ),
    );
    const first = runOf(await sync());
    expect(first).toMatchObject({ status: 'SUCCESS', hasMore: true });
    const second = runOf(await sync());
    expect(listSpy.mock.lastCall?.[2]).toMatchObject({ pageToken: 'page-2' });
    expect(second).toMatchObject({
      status: 'SUCCESS',
      hasMore: false,
      transactionsCreated: 1,
    });
    serveMailbox();
    await expectNoDuplicateActive();
  });

  it('a run that loses its lease keeps its counts, ends EXPIRED, and commits no progress', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    listSpy.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { ids: [...mailbox.keys()] };
    });
    const first = alice.agent.post(syncPath()).then((response) => response);
    await inside;
    // The first run stalls past its lease; another sync takes over.
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: { syncLeaseExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(runOf(await sync()).status).toBe('SUCCESS');
    const committed = await prisma.emailConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });

    release();
    const stalled = runOf(await first);
    expect(stalled).toMatchObject({
      status: 'EXPIRED',
      emailsFound: mailbox.size,
      hasMore: false,
      errorMessage:
        'The sync stopped before finishing; its progress was not saved',
    });
    const after = await prisma.emailConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    expect(after.syncCursor).toBe(committed.syncCursor);
    expect(after.lastSyncedAt).toEqual(committed.lastSyncedAt);
    expect(after.syncLeaseToken).toBeNull();
    await expectNoDuplicateActive();
  });

  it('a crashed run’s expired lease is recovered: the next sync proceeds and records the old run EXPIRED', async () => {
    const stale = await prisma.emailSyncRun.create({
      data: {
        emailConnectionId: connectionId,
        triggerType: 'MANUAL',
        leaseToken: 'stale',
        startedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    // Before any sync records it, a run older than a lease is shown EXPIRED.
    const listed = dataOf<Array<{ id: string; status: string }>>(
      await alice.agent
        .get(`/api/email-connections/${idPath(connectionId)}/sync-runs`)
        .expect(200),
    );
    expect(listed.find((run) => run.id === stale.id)?.status).toBe('EXPIRED');
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: {
        syncLeaseToken: 'stale',
        syncLeaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(runOf(await sync()).status).toBe('SUCCESS');
    expect(
      await prisma.emailSyncRun.findUniqueOrThrow({ where: { id: stale.id } }),
    ).toMatchObject({
      status: 'EXPIRED',
      finishedAt: expect.any(Date) as Date,
    });
    const runs = dataOf<Array<{ id: string; status: string }>>(
      await alice.agent
        .get(`/api/email-connections/${idPath(connectionId)}/sync-runs`)
        .expect(200),
    );
    expect(runs.find((run) => run.id === stale.id)?.status).toBe('EXPIRED');
    expect(JSON.stringify(runs)).not.toMatch(
      /leaseToken|cursorBefore|cursorAfter|stale/,
    );
  });

  it('a refused grant makes the connection reconnect-required, distinct from a disconnect', async () => {
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });
    refreshSpy.mockRejectedValueOnce(new GmailReconnectRequiredError());
    const runsBefore = await prisma.emailSyncRun.count({
      where: { emailConnectionId: connectionId },
    });
    const refused = await sync(503);
    expect(refused.body).toMatchObject({
      statusCode: 503,
      code: 'RECONNECT_REQUIRED',
    });
    expect(
      await prisma.emailSyncRun.count({
        where: { emailConnectionId: connectionId },
      }),
    ).toBe(runsBefore);
    const connection = dataOf<Array<Record<string, unknown>>>(
      await alice.agent.get('/api/email-connections').expect(200),
    )[0];
    expect(connection).toMatchObject({
      status: 'EXPIRED',
      reconnectRequired: true,
      recoveryAction: 'RECONNECT',
      disconnectedAt: null,
    });
  });

  it('disconnect keeps derived transactions and history; reconnecting resumes without duplicates', async () => {
    const before = {
      transactions: await transactionsOf(),
      runs: await prisma.emailSyncRun.count({
        where: { emailConnectionId: connectionId },
      }),
      parserRuns: await prisma.parserRun.count({
        where: { emailMessage: { userId: alice.id } },
      }),
    };
    // A run in progress when the user disconnects ends, rather than never.
    const inProgress = await prisma.emailSyncRun.create({
      data: {
        emailConnectionId: connectionId,
        triggerType: 'MANUAL',
        leaseToken: 'in-progress',
      },
    });
    before.runs += 1;
    await alice.agent
      .delete(`/api/email-connections/${idPath(connectionId)}`)
      .expect(200);
    expect(
      await prisma.emailSyncRun.findUniqueOrThrow({
        where: { id: inProgress.id },
      }),
    ).toMatchObject({
      status: 'EXPIRED',
      errorMessage: 'The connection was disconnected during the sync',
    });
    const stored = await prisma.emailConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    expect(stored).toMatchObject({
      status: 'REVOKED',
      accessTokenEncrypted: '',
      refreshTokenEncrypted: '',
      syncLeaseToken: null,
    });
    expect(stored.disconnectedAt).not.toBeNull();
    expect(await transactionsOf()).toEqual(before.transactions);
    expect(
      await prisma.emailSyncRun.count({
        where: { emailConnectionId: connectionId },
      }),
    ).toBe(before.runs);
    expect(
      await prisma.parserRun.count({
        where: { emailMessage: { userId: alice.id } },
      }),
    ).toBe(before.parserRuns);
    // A disconnected connection is gone for its owner: no sync, no run.
    await sync(404);

    // Reconnecting the same mailbox reactivates the same connection.
    await completeOAuth(
      randomBytes(32).toString('base64url'),
      randomBytes(32).toString('base64url'),
    );
    const connections = dataOf<
      Array<{ id: string; status: string; recoveryAction: string }>
    >(await alice.agent.get('/api/email-connections').expect(200));
    expect(connections).toEqual([
      expect.objectContaining({
        id: connectionId,
        status: 'ACTIVE',
        recoveryAction: 'NONE',
      }),
    ]);
    for (let replay = 1; replay <= REPLAYS; replay++) {
      const run = runOf(await sync());
      expect([replay, run.status, run.transactionsCreated]).toEqual([
        replay,
        'SUCCESS',
        0,
      ]);
      expect(await transactionsOf()).toEqual(before.transactions);
      await expectNoDuplicateActive();
    }
  });

  it('an inactive account cannot sync, and nothing is recorded', async () => {
    const runsBefore = await prisma.emailSyncRun.count({
      where: { emailConnectionId: connectionId },
    });
    const calls = listSpy.mock.calls.length;
    await prisma.user.update({
      where: { id: alice.id },
      data: { status: 'DISABLED' },
    });
    try {
      const response = await alice.agent.post(syncPath());
      expect(response.status).toBe(401);
    } finally {
      await prisma.user.update({
        where: { id: alice.id },
        data: { status: 'ACTIVE' },
      });
    }
    expect(
      await prisma.emailSyncRun.count({
        where: { emailConnectionId: connectionId },
      }),
    ).toBe(runsBefore);
    expect(listSpy.mock.calls.length).toBe(calls);
  });
});
