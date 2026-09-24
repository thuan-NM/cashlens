import {
  SYNC_POLICY,
  advanceCursor,
  backfillBoundary,
  hashQuery,
  parseCursor,
  planWindow,
  serializeCursor,
  windowQuery,
} from './sync-policy';

// T042 (EMAIL-005–EMAIL-007): bounded backfill, opaque cursor, continuation,
// and a cursor that never advances past unfinished work.

const NOW = new Date('2026-09-24T03:00:00.000Z');
const NOW_S = NOW.getTime() / 1000;
const Q = hashQuery('{from:notify@vcb.example.test}');

describe('sync window planning (T042)', () => {
  it('first sync starts at the earliest rule start date, or the default backfill', () => {
    expect(
      backfillBoundary(
        [
          new Date('2026-09-10T00:00:00Z'),
          null,
          new Date('2026-09-01T00:00:00Z'),
        ],
        NOW,
      ).toISOString(),
    ).toBe('2026-09-01T00:00:00.000Z');
    expect(backfillBoundary([null], NOW).toISOString()).toBe(
      new Date(
        NOW.getTime() - SYNC_POLICY.defaultBackfillDays * 86_400_000,
      ).toISOString(),
    );
    const backfillFrom = new Date('2026-09-01T00:00:00Z');
    expect(planWindow(null, { now: NOW, backfillFrom, queryHash: Q })).toEqual({
      windowStart: backfillFrom.getTime() / 1000,
      windowEnd: NOW_S,
    });
  });

  it('continues an unfinished window from its page token', () => {
    const cursor = {
      v: 1 as const,
      queryHash: Q,
      windowStart: 100,
      windowEnd: 200,
      pageToken: 'page-2',
    };
    expect(
      planWindow(cursor, { now: NOW, backfillFrom: new Date(0), queryHash: Q }),
    ).toEqual({ windowStart: 100, windowEnd: 200, pageToken: 'page-2' });
  });

  it('drops a page token when the listen rules changed', () => {
    const cursor = {
      v: 1 as const,
      queryHash: 'other-rules',
      windowStart: 100,
      windowEnd: 200,
      pageToken: 'page-2',
      watermark: NOW_S - 7200,
    };
    expect(
      planWindow(cursor, { now: NOW, backfillFrom: new Date(0), queryHash: Q }),
    ).toEqual({
      windowStart: NOW_S - 7200 - SYNC_POLICY.incrementalOverlapMs / 1000,
      windowEnd: NOW_S,
    });
  });

  it('an incremental sync starts at the watermark minus the overlap', () => {
    const watermark = NOW_S - 3600;
    expect(
      planWindow(
        { v: 1, queryHash: Q, watermark },
        { now: NOW, backfillFrom: new Date(0), queryHash: Q },
      ),
    ).toEqual({
      windowStart: watermark - SYNC_POLICY.incrementalOverlapMs / 1000,
      windowEnd: NOW_S,
    });
  });

  it('advances to the next page, completes the window, or stays put', () => {
    const window = { windowStart: 100, windowEnd: 200, pageToken: 'page-1' };
    expect(
      advanceCursor(null, window, {
        queryHash: Q,
        pageComplete: true,
        nextPageToken: 'page-2',
      }),
    ).toEqual({
      cursor: {
        v: 1,
        queryHash: Q,
        windowStart: 100,
        windowEnd: 200,
        pageToken: 'page-2',
        watermark: undefined,
      },
      windowComplete: false,
    });
    expect(
      advanceCursor(null, window, { queryHash: Q, pageComplete: true }),
    ).toEqual({
      cursor: { v: 1, queryHash: Q, watermark: 200 },
      windowComplete: true,
    });
    // A transient failure or the run budget: the same page is read again.
    expect(
      advanceCursor({ v: 1, queryHash: Q, watermark: 40 }, window, {
        queryHash: Q,
        pageComplete: false,
        nextPageToken: 'page-2',
      }),
    ).toEqual({
      cursor: {
        v: 1,
        queryHash: Q,
        windowStart: 100,
        windowEnd: 200,
        pageToken: 'page-1',
        watermark: 40,
      },
      windowComplete: false,
    });
  });

  it('the cursor round-trips, and anything unreadable restarts safely', () => {
    const cursor = { v: 1 as const, queryHash: Q, watermark: 7 };
    expect(parseCursor(serializeCursor(cursor))).toEqual(cursor);
    for (const bad of [null, '', 'not json', '{"v":2}', '{"v":1}']) {
      expect(parseCursor(bad)).toBeNull();
    }
  });

  it('builds the Gmail window query in epoch seconds', () => {
    expect(
      windowQuery('{from:notify@vcb.example.test}', {
        windowStart: 100,
        windowEnd: 200,
      }),
    ).toBe('{from:notify@vcb.example.test} after:100 before:200');
    expect(windowQuery('', { windowStart: 1, windowEnd: 2 })).toBe(
      'after:1 before:2',
    );
  });
});
