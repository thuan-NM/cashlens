import { Injectable } from '@nestjs/common';

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};
export type GmailMessagePage = { ids: string[]; nextPageToken?: string };

/**
 * Bounded retry for Gmail API calls (EMAIL-009): rate limits and transient
 * failures are retried with exponential backoff and full jitter, at most
 * `attempts` times; a Retry-After hint is honoured up to its cap.
 */
export const GMAIL_RETRY = {
  attempts: 3,
  /** Per attempt; a call that hangs longer is a transient failure. */
  requestTimeoutMs: 10_000,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  maxRetryAfterMs: 5_000,
} as const;

/**
 * - RATE_LIMITED, TRANSIENT: retried; if still failing, the work is retried
 *   by the next sync.
 * - AUTH: the user's access was refused (401, or a 403 for a missing
 *   scope); reconnect.
 * - REFUSED: Google refused the request for a reason outside the user's
 *   grant (project quota, API disabled, policy); not retried now, and never
 *   a reconnect — a later sync tries again.
 * - NOT_FOUND, PERMANENT: this request will never succeed (for example a
 *   deleted message); other messages continue.
 */
export type GmailFailureKind =
  | 'RATE_LIMITED'
  | 'TRANSIENT'
  | 'AUTH'
  | 'REFUSED'
  | 'NOT_FOUND'
  | 'PERMANENT';

const MESSAGES: Record<GmailFailureKind, string> = {
  RATE_LIMITED: 'Gmail rate limit reached',
  TRANSIENT: 'Gmail is temporarily unavailable',
  AUTH: 'Gmail access was refused',
  REFUSED: 'Gmail refused the request',
  NOT_FOUND: 'Gmail message not found',
  PERMANENT: 'Gmail request failed',
};

/** A classified Gmail failure; its message never carries provider data. */
export class GmailApiError extends Error {
  constructor(
    readonly kind: GmailFailureKind,
    readonly status?: number,
  ) {
    super(MESSAGES[kind]);
  }

  get retryable() {
    return this.kind === 'RATE_LIMITED' || this.kind === 'TRANSIENT';
  }
}

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
]);

/** 403 reasons that mean the user's own grant lacks access. */
const AUTH_REASONS = new Set(['insufficientPermissions', 'authError']);

@Injectable()
export class GmailApiService {
  /** Seams for deterministic tests. */
  sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  random = () => Math.random();

  async listMessageIds(
    accessToken: string,
    query: string,
    options: { pageToken?: string; maxResults?: number } = {},
  ): Promise<GmailMessagePage> {
    const params = new URLSearchParams({
      maxResults: String(options.maxResults ?? 100),
    });
    if (query) params.set('q', query);
    if (options.pageToken) params.set('pageToken', options.pageToken);
    const response = await this.request<{
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      accessToken,
    );
    return {
      ids: response.messages?.map((message) => message.id) ?? [],
      nextPageToken: response.nextPageToken,
    };
  }

  getMessage(accessToken: string, id: string) {
    return this.request<GmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      accessToken,
    );
  }

  /** Header text; NUL characters are dropped (the database refuses them). */
  header(message: GmailMessage, name: string) {
    return message.payload?.headers
      ?.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value.replaceAll('\u0000', '');
  }

  body(message: GmailMessage) {
    const values: string[] = [];
    const visit = (part?: GmailPart) => {
      if (!part) return;
      if (
        part.body?.data &&
        (part.mimeType === 'text/plain' || part.mimeType === 'text/html')
      ) {
        values.push(
          Buffer.from(part.body.data, 'base64url')
            .toString('utf8')
            .replaceAll('\u0000', ''),
        );
      }
      part.parts?.forEach(visit);
    };
    visit(message.payload);
    return values.join('\n');
  }

  private async request<T>(url: string, accessToken: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      let failure: GmailApiError;
      let retryAfterMs: number | undefined;
      const abort = new AbortController();
      const timer = setTimeout(
        () => abort.abort(),
        GMAIL_RETRY.requestTimeoutMs,
      );
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: abort.signal,
        });
        if (response.ok) {
          return (await response.json()) as T;
        }
        failure = new GmailApiError(
          await this.classify(response),
          response.status,
        );
        retryAfterMs = this.retryAfter(response.headers.get('retry-after'));
      } catch (error) {
        if (error instanceof GmailApiError) throw error;
        // Network failure or timeout: nothing from the provider to keep.
        failure = new GmailApiError('TRANSIENT');
      } finally {
        clearTimeout(timer);
      }
      if (!failure.retryable || attempt >= GMAIL_RETRY.attempts) {
        throw failure;
      }
      await this.sleep(this.delay(attempt, retryAfterMs));
    }
  }

  /** Full jitter under an exponential ceiling; a Retry-After hint wins. */
  private delay(attempt: number, retryAfterMs?: number) {
    const ceiling = Math.min(
      GMAIL_RETRY.maxDelayMs,
      GMAIL_RETRY.baseDelayMs * 2 ** (attempt - 1),
    );
    const jittered = ceiling * this.random();
    return retryAfterMs === undefined
      ? jittered
      : Math.max(jittered, retryAfterMs);
  }

  private retryAfter(value: string | null) {
    if (!value) return undefined;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(value) - Date.now();
    if (!Number.isFinite(ms) || ms < 0) return undefined;
    return Math.min(ms, GMAIL_RETRY.maxRetryAfterMs);
  }

  /** Reads only the status and Google's error reason, never the body text. */
  private async classify(response: Response): Promise<GmailFailureKind> {
    if (response.status === 429) return 'RATE_LIMITED';
    if (response.status >= 500) return 'TRANSIENT';
    if (response.status === 401) return 'AUTH';
    if (response.status === 404) return 'NOT_FOUND';
    if (response.status === 403) {
      const reason = await this.reason(response);
      if (RATE_LIMIT_REASONS.has(reason)) return 'RATE_LIMITED';
      return AUTH_REASONS.has(reason) ? 'AUTH' : 'REFUSED';
    }
    return 'PERMANENT';
  }

  private async reason(response: Response) {
    try {
      const body = (await response.json()) as {
        error?: { errors?: Array<{ reason?: unknown }>; status?: unknown };
      };
      const reason = body.error?.errors?.[0]?.reason;
      return typeof reason === 'string' ? reason : '';
    } catch {
      return '';
    }
  }
}
