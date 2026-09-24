import { createHash } from 'node:crypto';

/**
 * Bounds of one user-triggered synchronization (EMAIL-005 to EMAIL-007,
 * EMAIL-013). No scheduler: every run is started by the user and processes
 * at most one page of messages; the rest is a visible continuation.
 */
export const SYNC_POLICY = {
  /** Messages listed and processed by one run. */
  batchSize: 50,
  /** Initial import boundary when no listen rule sets a start date. */
  defaultBackfillDays: 30,
  /** One active run per connection; a crashed run's lease expires. */
  leaseTtlMs: 5 * 60_000,
  /**
   * Stop taking new messages after this (at least one message is always
   * attempted). Sync is a synchronous request: the listing and one message
   * are each bounded by 3 × 10 s attempts, so a run ends in about a minute —
   * well inside the lease; the reverse proxy must allow 90 s (research.md).
   */
  runBudgetMs: 25_000,
  /**
   * A message that fails this many times (a transient Gmail failure or an
   * unexpected error, never a rate limit) is given up and recorded FAILED,
   * so one poison message cannot hold its page back forever.
   */
  maxMessageAttempts: 3,
  /** Incremental windows overlap the last one; provider ids dedupe it. */
  incrementalOverlapMs: 10 * 60_000,
} as const;

/**
 * Opaque provider progress stored on the connection (`syncCursor`). A window
 * is `[windowStart, windowEnd)` in epoch seconds, read page by page;
 * `watermark` is the end of the last fully read window. A page token is only
 * valid for the query it came from, so the query hash travels with it.
 * `retries` counts failed attempts per provider message id while a page is
 * unfinished.
 */
export type SyncCursor = {
  v: 1;
  queryHash: string;
  windowStart?: number;
  windowEnd?: number;
  pageToken?: string;
  watermark?: number;
  retries?: Record<string, number>;
};

export type SyncWindow = {
  windowStart: number;
  windowEnd: number;
  pageToken?: string;
};

export const hashQuery = (query: string) =>
  createHash('sha256').update(query).digest('hex').slice(0, 16);

export const parseCursor = (value: string | null): SyncCursor | null => {
  if (!value) return null;
  try {
    const cursor = JSON.parse(value) as SyncCursor;
    return cursor?.v === 1 && typeof cursor.queryHash === 'string'
      ? cursor
      : null;
  } catch {
    return null;
  }
};

export const serializeCursor = (cursor: SyncCursor) => JSON.stringify(cursor);

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** The initial import boundary: the earliest rule start date, or the default. */
export const backfillBoundary = (
  ruleStarts: Array<Date | null>,
  now: Date,
): Date => {
  const starts = ruleStarts.filter((value): value is Date => Boolean(value));
  if (starts.length) {
    return new Date(Math.min(...starts.map((date) => date.getTime())));
  }
  return new Date(
    now.getTime() - SYNC_POLICY.defaultBackfillDays * 24 * 3_600_000,
  );
};

/**
 * The window this run reads. An unfinished window is continued from its page
 * token while the rules are unchanged; otherwise a new window starts at the
 * watermark (minus the overlap) or, the first time, at the backfill boundary,
 * and ends now.
 */
export const planWindow = (
  cursor: SyncCursor | null,
  input: { now: Date; backfillFrom: Date; queryHash: string },
): SyncWindow => {
  if (
    cursor?.pageToken &&
    cursor.queryHash === input.queryHash &&
    cursor.windowStart !== undefined &&
    cursor.windowEnd !== undefined
  ) {
    return {
      windowStart: cursor.windowStart,
      windowEnd: cursor.windowEnd,
      pageToken: cursor.pageToken,
    };
  }
  const start =
    cursor?.watermark !== undefined
      ? cursor.watermark - SYNC_POLICY.incrementalOverlapMs / 1000
      : seconds(input.backfillFrom);
  return {
    windowStart: Math.max(0, start),
    windowEnd: Math.max(seconds(input.now), start + 1),
  };
};

/**
 * The cursor after a run. It advances only when the whole page was handled;
 * a page with a transient failure, or cut short by the run budget, is read
 * again next time (already-processed messages are skipped by provider id).
 */
export const advanceCursor = (
  before: SyncCursor | null,
  window: SyncWindow,
  input: {
    queryHash: string;
    pageComplete: boolean;
    nextPageToken?: string;
    retries?: Record<string, number>;
  },
): { cursor: SyncCursor; windowComplete: boolean } => {
  if (!input.pageComplete) {
    const retries =
      input.retries && Object.keys(input.retries).length
        ? input.retries
        : undefined;
    return {
      cursor: {
        v: 1,
        queryHash: input.queryHash,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        pageToken: window.pageToken,
        watermark: before?.watermark,
        ...(retries ? { retries } : {}),
      },
      windowComplete: false,
    };
  }
  if (input.nextPageToken) {
    return {
      cursor: {
        v: 1,
        queryHash: input.queryHash,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        pageToken: input.nextPageToken,
        watermark: before?.watermark,
      },
      windowComplete: false,
    };
  }
  return {
    cursor: { v: 1, queryHash: input.queryHash, watermark: window.windowEnd },
    windowComplete: true,
  };
};

/** Gmail search clause for a window (epoch-second `after:`/`before:`). */
export const windowQuery = (query: string, window: SyncWindow) =>
  [query, `after:${window.windowStart}`, `before:${window.windowEnd}`]
    .filter(Boolean)
    .join(' ');
