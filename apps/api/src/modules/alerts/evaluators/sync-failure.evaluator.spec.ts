import type { EmailSyncStatus } from '@prisma/client';
import { evaluateSyncFailures } from './sync-failure.evaluator';

/** ALERT-009 repeated-sync-failure row (T075). Runs are newest first. */

const connection = (statuses: EmailSyncStatus[], disconnected = false) => ({
  id: 'c1',
  disconnectedAt: disconnected ? new Date('2026-09-23T00:00:00Z') : null,
  recentTerminalRuns: statuses.map((status, index) => ({
    id: `run-${index}`,
    status,
    finishedAt: new Date(Date.UTC(2026, 8, 23, 10 - index)),
  })),
});

const evaluate = (
  connections: ReturnType<typeof connection>[],
  openKeys: string[] = [],
) => evaluateSyncFailures({ connections, openKeys });

describe('evaluateSyncFailures (T075)', () => {
  it.each([
    [['FAILED', 'FAILED', 'FAILED']],
    [['EXPIRED', 'PARTIAL_FAILED', 'FAILED']],
    [['PARTIAL_FAILED', 'PARTIAL_FAILED', 'PARTIAL_FAILED']],
  ] as EmailSyncStatus[][][])(
    'holds as a SYSTEM WARNING for three failed terminal runs %p',
    (statuses) => {
      expect(evaluate([connection(statuses)])).toEqual([
        expect.objectContaining({
          key: 'sync-failure:c1',
          holds: true,
          mayCreate: true,
          type: 'SYSTEM',
          severity: 'WARNING',
          target: { resourceType: 'email_connection', resourceId: 'c1' },
          metadata: expect.objectContaining({
            condition: 'REPEATED_SYNC_FAILURE',
            runStatuses: statuses.join(','),
          }) as object,
        }),
      ]);
    },
  );

  it('does not hold with only two terminal runs', () => {
    expect(evaluate([connection(['FAILED', 'FAILED'])])[0].holds).toBe(false);
  });

  it('resolves with SYNC_SUCCEEDED after a later successful run', () => {
    expect(
      evaluate([connection(['SUCCESS', 'FAILED', 'FAILED'])])[0],
    ).toMatchObject({ holds: false, resolutionReason: 'SYNC_SUCCEEDED' });
  });

  it('does not hold when a success is among the last three', () => {
    expect(
      evaluate([connection(['FAILED', 'SUCCESS', 'FAILED'])])[0].holds,
    ).toBe(false);
  });

  it('ignores a RUNNING run: only terminal runs count', () => {
    expect(
      evaluate([connection(['RUNNING', 'FAILED', 'FAILED'])])[0].holds,
    ).toBe(false);
  });

  it('resolves with DISCONNECTED once the connection is disconnected', () => {
    expect(
      evaluate([connection(['FAILED', 'FAILED', 'FAILED'], true)])[0],
    ).toMatchObject({ holds: false, resolutionReason: 'DISCONNECTED' });
  });

  it('resolves the open key of a removed connection with TARGET_REMOVED', () => {
    expect(evaluate([], ['sync-failure:gone'])).toEqual([
      expect.objectContaining({
        key: 'sync-failure:gone',
        holds: false,
        resolutionReason: 'TARGET_REMOVED',
      }),
    ]);
  });
});
