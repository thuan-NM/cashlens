import type { EmailConnectionStatus } from '@prisma/client';
import type { AlertCondition } from './alert-condition';
import { KEY_PREFIX, idOfKey, reconnectKey } from './condition-keys';

/**
 * Reconnect-required row of ALERT-009 (EMAIL-003). Pure.
 *
 * Reconnect-required is the stored provider-authorization state: EXPIRED on
 * a connection the user has not disconnected (an expired or revoked grant,
 * a failed renewal, or a 401 during a sync). A user disconnect is REVOKED
 * with a disconnect time and never qualifies; ERROR is a provider or
 * project failure (a project-wide 403 is classified REFUSED, never AUTH)
 * and never qualifies.
 */

export type ReconnectConnection = {
  id: string;
  status: EmailConnectionStatus;
  disconnectedAt: Date | null;
};

export function evaluateReconnectRequired(input: {
  connections: ReconnectConnection[];
  /** Currently open `reconnect:` keys of the user. */
  openKeys: string[];
}): AlertCondition[] {
  const conditions = input.connections.map(
    (connection): AlertCondition => ({
      key: reconnectKey(connection.id),
      holds:
        connection.disconnectedAt === null && connection.status === 'EXPIRED',
      type: 'SYSTEM',
      severity: 'CRITICAL',
      target: { resourceType: 'email_connection', resourceId: connection.id },
      threshold: null,
      observed: null,
      window: null,
      mayCreate: true,
      resolutionReason:
        connection.disconnectedAt !== null
          ? 'DISCONNECTED'
          : connection.status === 'ACTIVE'
            ? 'RECONNECTED'
            : 'CONDITION_CLEARED',
      title: 'Reconnect your email',
      message:
        'The email provider refused access for an email connection. Reconnect it to continue synchronizing.',
      metadata: {
        condition: 'RECONNECT_REQUIRED',
        emailConnectionId: connection.id,
        connectionStatus: connection.status,
      },
    }),
  );

  const produced = new Set(conditions.map((condition) => condition.key));
  for (const key of input.openKeys) {
    const id = idOfKey(key, KEY_PREFIX.reconnect);
    if (!id || produced.has(key)) continue;
    conditions.push({
      key,
      holds: false,
      type: 'SYSTEM',
      severity: 'CRITICAL',
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
