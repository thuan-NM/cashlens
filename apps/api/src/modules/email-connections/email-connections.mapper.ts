import { EmailConnection } from '@prisma/client';

/**
 * What the user can do to recover a connection (EMAIL-003):
 * - NONE: healthy.
 * - RETRY: the last attempt failed for a temporary reason; sync again.
 * - RECONNECT: the provider refused the grant; a new consent flow is needed.
 * - CONNECT: the user disconnected it; connecting again starts a new grant.
 */
export type RecoveryAction = 'NONE' | 'RETRY' | 'RECONNECT' | 'CONNECT';

export const recoveryActionOf = (
  connection: Pick<EmailConnection, 'status' | 'disconnectedAt'>,
): RecoveryAction => {
  if (connection.disconnectedAt || connection.status === 'REVOKED') {
    return 'CONNECT';
  }
  if (connection.status === 'EXPIRED') return 'RECONNECT';
  if (connection.status === 'ERROR') return 'RETRY';
  return 'NONE';
};

/**
 * Connection identity, status, and sync progress. Credentials, the opaque
 * provider cursor, and the lease token are never returned.
 */
export const toEmailConnectionResponse = (connection: EmailConnection) => {
  const recoveryAction = recoveryActionOf(connection);
  return {
    id: connection.id,
    provider: connection.provider,
    emailAddress: connection.emailAddress,
    providerUserId: connection.providerUserId,
    tokenExpiresAt: connection.tokenExpiresAt.toISOString(),
    scopes: connection.scopes,
    status: connection.status,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    connectedAt: connection.connectedAt.toISOString(),
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
    errorMessage: connection.errorMessage,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    // Additive (T041, EMAIL-003, EMAIL-006).
    reconnectRequired: recoveryAction === 'RECONNECT',
    recoveryAction,
    lastFailedAt: connection.lastFailedAt?.toISOString() ?? null,
    backfillFrom: connection.backfillFrom?.toISOString() ?? null,
    backfillCompletedAt: connection.backfillCompletedAt?.toISOString() ?? null,
    syncInProgress: Boolean(
      connection.syncLeaseToken &&
      connection.syncLeaseExpiresAt &&
      connection.syncLeaseExpiresAt.getTime() > Date.now(),
    ),
  };
};
