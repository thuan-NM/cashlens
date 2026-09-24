import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EmailConnectionsService } from '../email-connections/email-connections.service';
import type { ParserService } from '../parser/parser.service';
import type { UsersRepository } from '../users/users.repository';
import type { EmailIngestionRepository } from './email-ingestion.repository';
import { EmailIngestionService } from './email-ingestion.service';
import {
  GmailApiError,
  GmailApiService,
  GmailMessage,
} from './gmail-api.service';
import {
  SYNC_POLICY,
  SyncCursor,
  parseCursor,
  serializeCursor,
} from './sync-policy';
import {
  ImportedTransactionFacts,
  normalizeTransactionCode,
  transactionIdentity,
} from './transaction-identity';

// T039 (EMAIL-007, EMAIL-008, TEST-002): layered deduplication. Precedence is
// provider message identity (the same Gmail message is never processed
// twice), then provider transaction identity (the bank's transaction code),
// then a documented deterministic fingerprint when no code exists.

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const facts = (
  over: Partial<ImportedTransactionFacts> = {},
): ImportedTransactionFacts => ({
  amount: 1250000,
  currency: 'VND',
  direction: 'EXPENSE',
  transactionTime: '2026-06-20T08:30:00.000Z',
  balanceAfter: 8750000,
  ...over,
});

describe('transaction identity (T039)', () => {
  it('normalizes a transaction code by case and whitespace', () => {
    expect(normalizeTransactionCode(' ft 26171 abc ')).toBe('FT26171ABC');
    expect(normalizeTransactionCode('FT26171ABC')).toBe('FT26171ABC');
  });

  it('prefers the provider transaction code, scoped to the bank', () => {
    expect(
      transactionIdentity(
        facts({ transactionCode: ' ft26171abc' }),
        'bank_vcb',
      ),
    ).toEqual({
      strategy: 'TRANSACTION_CODE',
      key: 'code:v1:bank_vcb:FT26171ABC',
    });
    // The same code is the same provider transaction, whatever else differs.
    expect(
      transactionIdentity(
        facts({ transactionCode: 'FT26171ABC', amount: 1, balanceAfter: 2 }),
        'bank_vcb',
      ).key,
    ).toBe('code:v1:bank_vcb:FT26171ABC');
    // Another bank's identical code is another transaction.
    expect(
      transactionIdentity(facts({ transactionCode: 'FT26171ABC' }), 'bank_tcb')
        .key,
    ).toBe('code:v1:bank_tcb:FT26171ABC');
  });

  it('falls back to a deterministic fingerprint without a code', () => {
    expect(transactionIdentity(facts(), 'bank_vcb')).toEqual({
      strategy: 'FINGERPRINT',
      key: `fp:v1:${sha256('bank_vcb|EXPENSE|VND|1250000.00|2026-06-20T08:30|8750000.00')}`,
    });
    expect(
      transactionIdentity(facts({ balanceAfter: undefined }), 'bank_vcb').key,
    ).toBe(
      `fp:v1:${sha256('bank_vcb|EXPENSE|VND|1250000.00|2026-06-20T08:30|')}`,
    );
  });

  it('the fingerprint ignores seconds but not the minute, amount, or balance', () => {
    const key = (over: Partial<ImportedTransactionFacts>) =>
      transactionIdentity(facts(over), 'bank_vcb').key;
    const base = key({});
    expect(key({ transactionTime: '2026-06-20T08:30:59.999Z' })).toBe(base);
    expect(key({ transactionTime: '2026-06-20T08:31:00.000Z' })).not.toBe(base);
    expect(key({ amount: 1250001 })).not.toBe(base);
    expect(key({ balanceAfter: 8749999 })).not.toBe(base);
    expect(key({ direction: 'INCOME' })).not.toBe(base);
    expect(key({ currency: 'USD' })).not.toBe(base);
  });

  it('an empty code falls back to the fingerprint', () => {
    expect(
      transactionIdentity(facts({ transactionCode: '  ' }), 'bank_vcb')
        .strategy,
    ).toBe('FINGERPRINT');
  });
});

describe('EmailIngestionService provider-message layer (T039)', () => {
  const connection = {
    id: 'conn-1',
    userId: 'user-1',
    provider: 'GMAIL',
    status: 'ACTIVE',
    disconnectedAt: null,
    syncCursor: null,
    backfillFrom: null,
    backfillCompletedAt: null,
    syncLeaseToken: null,
    syncLeaseExpiresAt: null,
  };
  const runRow = {
    id: 'run-1',
    emailConnectionId: 'conn-1',
    triggerType: 'MANUAL',
    status: 'SUCCESS',
    startedAt: new Date('2026-06-20T09:00:00.000Z'),
    finishedAt: new Date('2026-06-20T09:00:01.000Z'),
    createdAt: new Date('2026-06-20T09:00:00.000Z'),
    emailsFound: 1,
    emailsMatched: 0,
    emailsParsed: 0,
    emailsFailed: 0,
    transactionsCreated: 0,
    hasMore: false,
    errorMessage: null,
  };

  it('a provider message already processed is neither fetched nor parsed again', async () => {
    const explicit: Record<string, jest.Mock> = {
      enabledRules: jest.fn().mockResolvedValue([
        {
          id: 'rule-1',
          userId: 'user-1',
          emailConnectionId: 'conn-1',
          bankProviderId: 'bank_vcb',
          senderEmail: 'notify@vcb.example.test',
          senderDomain: null,
          subjectContains: null,
          bodyContains: null,
          syncFromDate: new Date('2026-06-01T00:00:00.000Z'),
          isEnabled: true,
          priority: 1,
        },
      ]),
      findMessageByProvider: jest.fn().mockResolvedValue({
        id: 'msg-1',
        processingStatus: 'PARSED',
        transaction: { id: 'tx-1' },
      }),
      acquireLease: jest.fn().mockResolvedValue({
        token: 'lease-1',
        run: { ...runRow, status: 'RUNNING' },
        connection,
      }),
    };
    // Any other repository call answers with the run row.
    const repository = new Proxy(explicit, {
      get: (target, property: string) =>
        (target[property] ??= jest.fn().mockResolvedValue(runRow)),
    });
    const connections = {
      findOwned: jest.fn().mockResolvedValue(connection),
      validAccessToken: jest
        .fn()
        .mockResolvedValue({ connection, accessToken: 'access-token' }),
    };
    const gmail = {
      listMessageIds: jest.fn().mockResolvedValue({ ids: ['gmail-1'] }),
      getMessage: jest.fn(),
    };
    const parser = { parseMessage: jest.fn() };
    const users = { recordAudit: jest.fn().mockResolvedValue(undefined) };

    const service = new EmailIngestionService(
      repository as unknown as EmailIngestionRepository,
      connections as unknown as EmailConnectionsService,
      gmail as unknown as GmailApiService,
      parser as unknown as ParserService,
      users as unknown as UsersRepository,
    );
    await service.sync({ id: 'user-1' }, 'conn-1');

    expect(explicit.findMessageByProvider).toHaveBeenCalledWith(
      'conn-1',
      'gmail-1',
    );
    expect(gmail.getMessage).not.toHaveBeenCalled();
    expect(parser.parseMessage).not.toHaveBeenCalled();
  });
});

describe('EmailIngestionService bounded sync loop (T042, T044)', () => {
  const NOW = new Date('2026-06-20T09:00:00.000Z');
  const NOW_S = NOW.getTime() / 1000;
  const rule = {
    id: 'rule-1',
    userId: 'user-1',
    emailConnectionId: 'conn-1',
    bankProviderId: 'bank_vcb',
    senderEmail: 'notify@vcb.example.test',
    senderDomain: null,
    subjectContains: null,
    bodyContains: null,
    syncFromDate: new Date('2026-06-01T00:00:00.000Z'),
    isEnabled: true,
    priority: 1,
  };
  const gmailMessage = (
    id: string,
    receivedAt = NOW.getTime() - 60_000,
  ): GmailMessage => ({
    id,
    internalDate: String(receivedAt),
    payload: {
      headers: [
        { name: 'From', value: 'VCB <notify@vcb.example.test>' },
        { name: 'Subject', value: 'Biến động số dư' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: {
            data: Buffer.from('Số tiền: -1,000 VND').toString('base64url'),
          },
        },
      ],
    },
  });

  const harness = (
    options: {
      ids?: string[];
      nextPageToken?: string;
      cursor?: SyncCursor | null;
      lease?: null;
    } = {},
  ) => {
    let clock = NOW.getTime();
    const repository = {
      enabledRules: jest.fn().mockResolvedValue([rule]),
      acquireLease: jest.fn().mockResolvedValue(
        options.lease === null
          ? null
          : {
              token: 'lease-1',
              run: { id: 'run-1', status: 'RUNNING' },
              connection: {
                syncCursor: options.cursor
                  ? serializeCursor(options.cursor)
                  : null,
                backfillFrom: null,
                backfillCompletedAt: null,
              },
            },
      ),
      findMessageByProvider: jest.fn().mockResolvedValue(null),
      upsertMessage: jest.fn((data: { providerMessageId: string }) =>
        Promise.resolve({ id: `msg-${data.providerMessageId}` }),
      ),
      markRuleMatched: jest.fn().mockResolvedValue(undefined),
      markMessageFailed: jest.fn().mockResolvedValue(undefined),
      // Typed with all three positions so finish() can read each argument.
      finishRun: jest.fn(
        (
          ...[, run]: [
            lease: unknown,
            run: Record<string, unknown>,
            connection: unknown,
          ]
        ) =>
          Promise.resolve({
            id: 'run-1',
            emailConnectionId: 'conn-1',
            triggerType: 'MANUAL',
            startedAt: NOW,
            finishedAt: NOW,
            createdAt: NOW,
            leaseToken: 'lease-1',
            cursorBefore: null,
            ...run,
          }),
      ),
    };
    const connections = {
      validAccessToken: jest.fn().mockResolvedValue({
        connection: { id: 'conn-1' },
        accessToken: 'access-token',
      }),
    };
    const gmail = new GmailApiService();
    const list = jest.spyOn(gmail, 'listMessageIds').mockResolvedValue({
      ids: options.ids ?? ['a', 'b'],
      nextPageToken: options.nextPageToken,
    });
    const get = jest
      .spyOn(gmail, 'getMessage')
      .mockImplementation((_token, id) => Promise.resolve(gmailMessage(id)));
    const parser = {
      parseMessage: jest
        .fn()
        .mockResolvedValue({ transactionId: 'tx', created: true }),
    };
    const users = { recordAudit: jest.fn().mockResolvedValue(undefined) };
    const service = new EmailIngestionService(
      repository as unknown as EmailIngestionRepository,
      connections as unknown as EmailConnectionsService,
      gmail,
      parser as unknown as ParserService,
      users as unknown as UsersRepository,
    );
    service.now = () => new Date(clock);
    const finish = () => {
      const [lease, run, connection] = repository.finishRun.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      return {
        lease,
        run,
        connection,
        cursor: parseCursor((connection.syncCursor as string) ?? null),
      };
    };
    return {
      repository,
      list,
      get,
      parser,
      service,
      finish,
      tick: (ms: number) => (clock += ms),
      sync: () => service.sync({ id: 'user-1' }, 'conn-1'),
    };
  };

  /** The hash the service derives for the rule above. */
  const queryHashOfRule = async () => {
    const first = harness();
    await first.sync();
    return first.finish().cursor!.queryHash;
  };

  it('reads one bounded page in a time window and commits the next page token', async () => {
    const h = harness({ nextPageToken: 'page-2' });
    const result = await h.sync();

    const [, query, pageOptions] = h.list.mock.calls[0];
    expect(query).toBe(
      `{from:notify@vcb.example.test} after:${rule.syncFromDate.getTime() / 1000} before:${NOW_S}`,
    );
    expect(pageOptions).toEqual({
      pageToken: undefined,
      maxResults: SYNC_POLICY.batchSize,
    });
    const { lease, run, connection, cursor } = h.finish();
    expect(lease).toEqual({
      token: 'lease-1',
      runId: 'run-1',
      connectionId: 'conn-1',
    });
    expect(run).toMatchObject({
      status: 'SUCCESS',
      emailsFound: 2,
      emailsMatched: 2,
      emailsParsed: 2,
      transactionsCreated: 2,
      emailsFailed: 0,
      hasMore: true,
      errorMessage: null,
    });
    expect(cursor).toMatchObject({ pageToken: 'page-2', windowEnd: NOW_S });
    expect(connection).toMatchObject({
      status: 'ACTIVE',
      errorMessage: null,
      lastSyncedAt: NOW,
      backfillFrom: rule.syncFromDate,
    });
    expect(connection.backfillCompletedAt).toBeUndefined();
    // The response never exposes the lease or the provider cursor.
    expect(result).not.toHaveProperty('leaseToken');
    expect(result).not.toHaveProperty('cursorBefore');
    expect(result).not.toHaveProperty('cursorAfter');
    expect(result).toMatchObject({ status: 'SUCCESS', hasMore: true });
  });

  it('the last page completes the window: the watermark advances', async () => {
    const h = harness();
    await h.sync();
    const { run, connection, cursor } = h.finish();
    expect(run).toMatchObject({ status: 'SUCCESS', hasMore: false });
    expect(cursor).toEqual({
      v: 1,
      queryHash: expect.any(String) as string,
      watermark: NOW_S,
    });
    expect(connection.backfillCompletedAt).toEqual(NOW);
  });

  it('a transient failure stops the page and keeps the cursor on it', async () => {
    const cursor = {
      v: 1 as const,
      queryHash: await queryHashOfRule(),
      windowStart: 100,
      windowEnd: 200,
      pageToken: 'page-1',
    };
    const h = harness({
      ids: ['a', 'b', 'c'],
      nextPageToken: 'page-2',
      cursor,
    });
    h.get.mockImplementation((_token, id) => {
      if (id === 'b')
        return Promise.reject(new GmailApiError('TRANSIENT', 503));
      return Promise.resolve(gmailMessage(id));
    });
    await h.sync();
    expect(h.list.mock.calls[0][2]).toMatchObject({ pageToken: 'page-1' });
    expect(h.get.mock.calls.map(([, id]) => id)).toEqual(['a', 'b']);
    const { run, connection } = h.finish();
    expect(run).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsParsed: 1,
      emailsFailed: 1,
      hasMore: true,
    });
    expect(h.finish().cursor).toMatchObject({
      windowStart: 100,
      windowEnd: 200,
      pageToken: 'page-1',
    });
    expect(connection.status).toBe('ACTIVE');
  });

  it('a permanent message failure does not hold the page back', async () => {
    const h = harness({ ids: ['a', 'b', 'c'] });
    h.get.mockImplementation((_token, id) => {
      if (id === 'b')
        return Promise.reject(new GmailApiError('NOT_FOUND', 404));
      return Promise.resolve(gmailMessage(id));
    });
    await h.sync();
    const { run, cursor } = h.finish();
    expect(h.get).toHaveBeenCalledTimes(3);
    expect(run).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsParsed: 2,
      emailsFailed: 1,
      hasMore: false,
      errorMessage: '1 message(s) failed',
    });
    expect(cursor).toMatchObject({ watermark: NOW_S });
  });

  it('the run budget stops taking messages; the run succeeds with more to do', async () => {
    const h = harness({ ids: ['a', 'b'] });
    h.get.mockImplementation((_token, id) => {
      h.tick(SYNC_POLICY.runBudgetMs);
      return Promise.resolve(gmailMessage(id));
    });
    await h.sync();
    expect(h.get).toHaveBeenCalledTimes(1);
    const { run, cursor } = h.finish();
    expect(run).toMatchObject({
      status: 'SUCCESS',
      emailsParsed: 1,
      hasMore: true,
    });
    expect(cursor?.watermark).toBeUndefined();
    expect(cursor).toMatchObject({ windowEnd: NOW_S });
  });

  it('a listing failure fails the run, leaves the cursor untouched, and asks for a retry', async () => {
    const h = harness();
    h.list.mockRejectedValue(new GmailApiError('RATE_LIMITED', 429));
    const result = await h.sync();
    const { run, connection } = h.finish();
    expect(run).toMatchObject({
      status: 'FAILED',
      hasMore: false,
      emailsFound: 0,
      errorMessage: 'Gmail is temporarily unavailable; sync again later',
    });
    expect(connection).not.toHaveProperty('syncCursor');
    expect(connection).toMatchObject({ status: 'ERROR', lastFailedAt: NOW });
    expect(connection).not.toHaveProperty('lastSyncedAt');
    expect(result).toMatchObject({ status: 'FAILED' });
  });

  it('refused Gmail access mid-run makes the connection reconnect-required', async () => {
    const h = harness();
    h.get.mockRejectedValue(new GmailApiError('AUTH', 401));
    await h.sync();
    const { run, connection } = h.finish();
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({
      status: 'FAILED',
      emailsFailed: 1,
      hasMore: false,
    });
    expect(connection).toMatchObject({ status: 'EXPIRED', lastFailedAt: NOW });
  });

  it('a stale page token restarts the same window from its start', async () => {
    const h = harness({
      cursor: {
        v: 1,
        queryHash: await queryHashOfRule(),
        windowStart: 100,
        windowEnd: 200,
        pageToken: 'stale',
      },
    });
    h.list
      .mockRejectedValueOnce(new GmailApiError('PERMANENT', 400))
      .mockResolvedValueOnce({ ids: ['a'] });
    await h.sync();
    expect(h.list.mock.calls.map(([, , o]) => o?.pageToken)).toEqual([
      'stale',
      undefined,
    ]);
    expect(h.list.mock.calls[1][1]).toContain('after:100 before:200');
    const { run, cursor } = h.finish();
    expect(run).toMatchObject({ status: 'SUCCESS', emailsParsed: 1 });
    expect(cursor).toMatchObject({ watermark: 200 });
  });

  it('an active lease is a 409 and nothing is read or recorded', async () => {
    const h = harness({ lease: null });
    const error = await h.sync().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code: 'SYNC_IN_PROGRESS',
    });
    expect(h.list).not.toHaveBeenCalled();
    expect(h.repository.finishRun).not.toHaveBeenCalled();
  });

  it('an unexpected error still finishes the run and releases the lease, with a fixed message', async () => {
    const h = harness();
    h.list.mockRejectedValue(new Error('postgres://user:SECRET@db failed'));
    const result = await h.sync();
    const { run, connection } = h.finish();
    expect(run).toMatchObject({
      status: 'FAILED',
      errorMessage: 'Sync failed; sync again later',
    });
    expect(connection).toMatchObject({ status: 'ERROR' });
    expect(JSON.stringify([run, connection, result])).not.toContain('SECRET');
  });

  it('a message before its rule start date is not imported', async () => {
    const h = harness({ ids: ['old'] });
    h.get.mockResolvedValue(
      gmailMessage('old', rule.syncFromDate.getTime() - 1),
    );
    await h.sync();
    expect(h.repository.upsertMessage).not.toHaveBeenCalled();
    expect(h.parser.parseMessage).not.toHaveBeenCalled();
    expect(h.finish().run).toMatchObject({
      status: 'SUCCESS',
      emailsMatched: 0,
    });
  });

  it('a parse failure is a counted message failure; no body or snippet is stored', async () => {
    const h = harness({ ids: ['a'] });
    h.parser.parseMessage.mockResolvedValue({ created: false, parserRun: {} });
    await h.sync();
    const stored = h.repository.upsertMessage.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(stored).not.toHaveProperty('snippet');
    expect(JSON.stringify(stored)).not.toContain('1,000');
    expect(h.finish().run).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsMatched: 1,
      emailsParsed: 0,
      emailsFailed: 1,
    });
  });

  it('a message that keeps failing is retried on later syncs, then given up so the page advances', async () => {
    const queryHash = await queryHashOfRule();
    const page = {
      v: 1 as const,
      queryHash,
      windowStart: 100,
      windowEnd: 200,
      pageToken: 'page-1',
    };
    // A deterministic storage error, e.g. text the database refuses.
    const poison = (_token: string, id: string) =>
      id === 'b'
        ? Promise.reject(new Error('invalid byte sequence'))
        : Promise.resolve(gmailMessage(id));

    const first = harness({ ids: ['a', 'b'], cursor: page });
    first.get.mockImplementation(poison);
    await first.sync();
    expect(first.finish().run).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsFailed: 1,
      hasMore: true,
    });
    expect(first.finish().cursor).toMatchObject({
      pageToken: 'page-1',
      retries: { b: 1 },
    });
    expect(first.repository.markMessageFailed).not.toHaveBeenCalled();

    const last = harness({
      ids: ['a', 'b'],
      cursor: { ...page, retries: { b: SYNC_POLICY.maxMessageAttempts - 1 } },
    });
    last.get.mockImplementation(poison);
    await last.sync();
    expect(last.repository.markMessageFailed).toHaveBeenCalledWith(
      'conn-1',
      'b',
    );
    expect(last.finish().run).toMatchObject({
      status: 'PARTIAL_FAILED',
      emailsFailed: 1,
      hasMore: false,
    });
    expect(last.finish().cursor).toEqual({ v: 1, queryHash, watermark: 200 });
  });

  it('a rate limit is not the message’s fault: it never counts as an attempt', async () => {
    const h = harness({ ids: ['a'] });
    h.get.mockRejectedValue(new GmailApiError('RATE_LIMITED', 429));
    await h.sync();
    expect(h.finish().cursor?.retries).toBeUndefined();
  });

  it('a slow listing still processes at least one message per run', async () => {
    const h = harness({ ids: ['a', 'b'] });
    h.list.mockImplementation(() => {
      h.tick(SYNC_POLICY.runBudgetMs);
      return Promise.resolve({ ids: ['a', 'b'] });
    });
    await h.sync();
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.finish().run).toMatchObject({
      status: 'SUCCESS',
      emailsParsed: 1,
      hasMore: true,
    });
  });
});
