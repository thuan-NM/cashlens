import { randomBytes } from 'node:crypto';
import {
  GMAIL_RETRY,
  GmailApiError,
  GmailApiService,
} from './gmail-api.service';

// T043 (EMAIL-009, ERR-003): bounded retry with exponential backoff and full
// jitter for rate limits and transient provider failures; revoked access and
// permanent message failures are not retried; failures are classified with
// sanitized messages that never carry tokens, queries, or provider bodies.

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const googleError = (status: number, reason: string) =>
  json(status, {
    error: {
      code: status,
      message: `detail ${reason}`,
      errors: [{ reason, message: 'provider detail' }],
    },
  });

describe('GmailApiService retry and classification (T043)', () => {
  let service: GmailApiService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let sleeps: number[];
  const token = randomBytes(24).toString('base64url');

  beforeEach(() => {
    service = new GmailApiService();
    sleeps = [];
    service.sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    service.random = () => 1; // the upper edge of the jitter window
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  const failureOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as GmailApiError;
    }
    throw new Error('expected a failure');
  };

  it('lists one page with the query, page token, and page size', async () => {
    fetchSpy.mockResolvedValue(
      json(200, {
        messages: [{ id: 'a' }, { id: 'b' }],
        nextPageToken: 'next-1',
      }),
    );
    await expect(
      service.listMessageIds(token, 'from:notify@vcb.example.test', {
        pageToken: 'page-0',
        maxResults: 2,
      }),
    ).resolves.toEqual({ ids: ['a', 'b'], nextPageToken: 'next-1' });
    const url = new URL((fetchSpy.mock.calls[0][0] as string | URL).toString());
    expect(url.searchParams.get('q')).toBe('from:notify@vcb.example.test');
    expect(url.searchParams.get('pageToken')).toBe('page-0');
    expect(url.searchParams.get('maxResults')).toBe('2');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  it('every request is bounded by a timeout, and a hung call is a transient failure', async () => {
    // A call that never answers until its abort signal fires.
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal!;
          // abort() without a reason: an AbortError DOMException.
          signal.addEventListener('abort', () =>
            reject(signal.reason as Error),
          );
        }),
    );
    jest.useFakeTimers();
    try {
      const pending = failureOf(service.getMessage(token, 'm-1'));
      for (let attempt = 0; attempt < GMAIL_RETRY.attempts; attempt++) {
        await jest.advanceTimersByTimeAsync(GMAIL_RETRY.requestTimeoutMs);
      }
      const failure = await pending;
      expect(failure).toBeInstanceOf(GmailApiError);
      expect(failure.kind).toBe('TRANSIENT');
      expect(fetchSpy).toHaveBeenCalledTimes(GMAIL_RETRY.attempts);
    } finally {
      jest.useRealTimers();
    }
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('an empty mailbox page has no ids and no next page', async () => {
    fetchSpy.mockResolvedValue(json(200, { resultSizeEstimate: 0 }));
    await expect(service.listMessageIds(token, '')).resolves.toEqual({
      ids: [],
      nextPageToken: undefined,
    });
  });

  it('retries a rate limit and then succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(429, { error: { code: 429 } }))
      .mockResolvedValueOnce(json(200, { id: 'm-1' }));
    await expect(service.getMessage(token, 'm-1')).resolves.toEqual({
      id: 'm-1',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([GMAIL_RETRY.baseDelayMs]);
  });

  it('stops after the attempt bound with exponentially growing, capped delays', async () => {
    fetchSpy.mockResolvedValue(json(503, { error: { code: 503 } }));
    const failure = await failureOf(service.getMessage(token, 'm-1'));
    expect(failure).toBeInstanceOf(GmailApiError);
    expect(failure.kind).toBe('TRANSIENT');
    expect(fetchSpy).toHaveBeenCalledTimes(GMAIL_RETRY.attempts);
    expect(sleeps).toEqual([
      GMAIL_RETRY.baseDelayMs,
      Math.min(GMAIL_RETRY.maxDelayMs, GMAIL_RETRY.baseDelayMs * 2),
    ]);
  });

  it('applies full jitter below the exponential ceiling', async () => {
    service.random = () => 0.25;
    fetchSpy.mockResolvedValue(json(500, {}));
    await failureOf(service.getMessage(token, 'm-1'));
    expect(sleeps).toEqual([
      GMAIL_RETRY.baseDelayMs * 0.25,
      GMAIL_RETRY.baseDelayMs * 2 * 0.25,
    ]);
  });

  it('honours Retry-After but never waits longer than its cap', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '120' }))
      .mockResolvedValueOnce(json(200, { id: 'm-1' }));
    await service.getMessage(token, 'm-1');
    expect(sleeps).toEqual([2000, GMAIL_RETRY.maxRetryAfterMs]);
  });

  it('treats a 403 rate-limit reason as a rate limit, read from the body', async () => {
    fetchSpy
      .mockResolvedValueOnce(googleError(403, 'userRateLimitExceeded'))
      .mockResolvedValueOnce(json(200, { id: 'm-1' }));
    await expect(service.getMessage(token, 'm-1')).resolves.toEqual({
      id: 'm-1',
    });
  });

  it('retries a network failure as transient', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(200, { id: 'm-1' }));
    await expect(service.getMessage(token, 'm-1')).resolves.toEqual({
      id: 'm-1',
    });
  });

  it('treats a daily quota as a rate limit', async () => {
    fetchSpy
      .mockResolvedValueOnce(googleError(403, 'dailyLimitExceeded'))
      .mockResolvedValueOnce(json(200, { id: 'm-1' }));
    await expect(service.getMessage(token, 'm-1')).resolves.toEqual({
      id: 'm-1',
    });
  });

  it.each([
    [401, 'authError', 'AUTH'],
    [403, 'insufficientPermissions', 'AUTH'],
    // Project-level refusals are not the user's grant: never a reconnect.
    [403, 'accessNotConfigured', 'REFUSED'],
    [403, 'domainPolicy', 'REFUSED'],
    [403, '', 'REFUSED'],
    [404, 'notFound', 'NOT_FOUND'],
    [400, 'invalidArgument', 'PERMANENT'],
  ])('does not retry %s (%s)', async (status, reason, kind) => {
    fetchSpy.mockResolvedValue(googleError(status, reason));
    const failure = await failureOf(service.getMessage(token, 'm-1'));
    expect(failure.kind).toBe(kind);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('failure messages never carry the token, the query, or the provider body', async () => {
    fetchSpy.mockResolvedValue(
      json(400, { error: { message: `bad query for ${token}` } }),
    );
    const failure = await failureOf(
      service.listMessageIds(token, 'from:secret-sender@vcb.example.test'),
    );
    const text = `${failure.message} ${JSON.stringify(failure)}`;
    for (const secret of [token, 'secret-sender', 'bad query']) {
      expect(text.includes(secret)).toBe(false);
    }
  });

  it('headers and bodies never carry NUL characters, which the database refuses', () => {
    const message = {
      id: 'm-1',
      payload: {
        headers: [{ name: 'Subject', value: 'Biến\u0000 động' }],
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from('Số tiền:\u0000 1,000').toString('base64url'),
            },
          },
        ],
      },
    };
    expect(service.header(message, 'Subject')).toBe('Biến động');
    expect(service.body(message)).toBe('Số tiền: 1,000');
  });
});
