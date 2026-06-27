import { EmailConnection } from '@prisma/client';

export const toEmailConnectionResponse = (connection: EmailConnection) => ({
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
});
