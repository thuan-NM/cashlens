import type { EmailSyncStatus } from '@prisma/client';
import type { AlertCondition } from './alert-condition';
import { KEY_PREFIX, idOfKey, syncFailureKey } from './condition-keys';

/**
 * Repeated-sync-failure row of ALERT-009 (EMAIL-005). Pure.
 *
 * - Holds when the three most recent terminal runs of a connected
 *   connection all ended FAILED, EXPIRED, or PARTIAL_FAILED.
 * - Resolves when a later run succeeds (SYNC_SUCCEEDED), the connection is
 *   disconnected (DISCONNECTED), or it is gone (TARGET_REMOVED).
 */

const FAILED_TERMINAL: EmailSyncStatus[] = [
  'FAILED',
  'EXPIRED',
  'PARTIAL_FAILED',
];
export const REPEATED_FAILURE_RUNS = 3;

export type SyncFailureConnection = {
  id: string;
  disconnectedAt: Date | null;
  /** Newest first; RUNNING rows are skipped. */
  recentTerminalRuns: {
    id: string;
    status: EmailSyncStatus;
    finishedAt: Date | null;
  }[];
};

export function evaluateSyncFailures(input: {
  connections: SyncFailureConnection[];
  /** Currently open `sync-failure:` keys of the user. */
  openKeys: string[];
}): AlertCondition[] {
  const conditions = input.connections.map((connection): AlertCondition => {
    const runs = connection.recentTerminalRuns
      .filter((run) => run.status !== 'RUNNING')
      .slice(0, REPEATED_FAILURE_RUNS);
    const connected = connection.disconnectedAt === null;
    const holds =
      connected &&
      runs.length === REPEATED_FAILURE_RUNS &&
      runs.every((run) => FAILED_TERMINAL.includes(run.status));
    const finished = runs
      .map((run) => run.finishedAt)
      .filter((time): time is Date => time !== null);
    return {
      key: syncFailureKey(connection.id),
      holds,
      type: 'SYSTEM',
      severity: 'WARNING',
      target: { resourceType: 'email_connection', resourceId: connection.id },
      threshold: null,
      observed: null,
      window: finished.length
        ? { start: finished[finished.length - 1], end: finished[0] }
        : null,
      mayCreate: true,
      resolutionReason: !connected
        ? 'DISCONNECTED'
        : runs[0]?.status === 'SUCCESS'
          ? 'SYNC_SUCCEEDED'
          : 'CONDITION_CLEARED',
      title: 'Email sync keeps failing',
      message:
        'The last three synchronizations of an email connection did not complete. Open the email connection to sync again or reconnect.',
      metadata: {
        condition: 'REPEATED_SYNC_FAILURE',
        emailConnectionId: connection.id,
        runIds: runs.map((run) => run.id).join(','),
        runStatuses: runs.map((run) => run.status).join(','),
      },
    };
  });

  const produced = new Set(conditions.map((condition) => condition.key));
  for (const key of input.openKeys) {
    const id = idOfKey(key, KEY_PREFIX.syncFailure);
    if (!id || produced.has(key)) continue;
    conditions.push({
      key,
      holds: false,
      type: 'SYSTEM',
      severity: 'WARNING',
      target: { resourceType: 'email_connection', resourceId: id },
      threshold: null,
      observed: null,
      window: null,
      mayCreate: false,
      resolutionReason: 'TARGET_REMOVED',
      title: '',
      message: '',
      metadata: {},
    });
  }
  return conditions;
}
