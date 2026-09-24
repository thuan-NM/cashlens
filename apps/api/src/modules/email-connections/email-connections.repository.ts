import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';

/** Why a connection needs a new consent flow (provider-auth failure). */
export const RECONNECT_REQUIRED_MESSAGE =
  'Gmail access expired or was revoked; reconnect Gmail';

@Injectable()
export class EmailConnectionsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string) {
    return this.prisma.emailConnection.findMany({
      where: { userId, disconnectedAt: null },
      orderBy: { connectedAt: 'desc' },
    });
  }

  findOwned(userId: string, id: string) {
    return this.prisma.emailConnection.findFirst({
      where: { id, userId, disconnectedAt: null },
    });
  }

  upsert(
    userId: string,
    emailAddress: string,
    data: Omit<
      Prisma.EmailConnectionUncheckedCreateInput,
      'userId' | 'emailAddress'
    >,
  ) {
    return this.prisma.emailConnection.upsert({
      where: {
        userId_provider_emailAddress: {
          userId,
          provider: data.provider,
          emailAddress,
        },
      },
      create: { userId, emailAddress, ...data },
      update: {
        ...data,
        disconnectedAt: null,
        connectedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  /**
   * Stores refreshed tokens only while the connection is still connected
   * with the grant that was refreshed; a disconnect or reconnect that landed
   * meanwhile wins (DATA-002). Returns how many rows were written (0 or 1).
   */
  async updateTokens(
    id: string,
    refreshedGrant: string,
    data: Pick<
      Prisma.EmailConnectionUpdateInput,
      | 'accessTokenEncrypted'
      | 'refreshTokenEncrypted'
      | 'tokenExpiresAt'
      | 'status'
      | 'errorMessage'
    >,
  ) {
    const { count } = await this.prisma.emailConnection.updateMany({
      where: {
        id,
        disconnectedAt: null,
        refreshTokenEncrypted: refreshedGrant,
      },
      data,
    });
    return count;
  }

  /**
   * The provider refused the stored grant: reconnect required (EXPIRED). This
   * is a provider-auth failure, recorded distinctly from a user disconnect.
   */
  markReconnectRequired(id: string) {
    // A user disconnect that landed meanwhile is not overwritten.
    return this.prisma.emailConnection.updateMany({
      where: { id, disconnectedAt: null },
      data: {
        status: 'EXPIRED',
        errorMessage: RECONNECT_REQUIRED_MESSAGE,
        lastFailedAt: new Date(),
      },
    });
  }

  /**
   * Owner-scoped (SEC-001); null when the caller owns no such connection.
   * A user disconnect (REVOKED) clears the credentials and any sync lease,
   * and records any RUNNING run of the connection as EXPIRED.
   */
  disconnect(userId: string, id: string) {
    return nullIfNotFound(
      this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const connection = await tx.emailConnection.update({
          where: { id, userId, disconnectedAt: null },
          data: {
            status: 'REVOKED',
            disconnectedAt: now,
            accessTokenEncrypted: '',
            refreshTokenEncrypted: '',
            syncLeaseToken: null,
            syncLeaseExpiresAt: null,
          },
        });
        // A run in progress can no longer commit; it ends here, not never.
        await tx.emailSyncRun.updateMany({
          where: { emailConnectionId: id, status: 'RUNNING' },
          data: {
            status: 'EXPIRED',
            finishedAt: now,
            hasMore: false,
            errorMessage: 'The connection was disconnected during the sync',
          },
        });
        return connection;
      }),
    );
  }

  /** The OAuth callback bypasses JwtStrategy, so it checks the account itself. */
  async isActiveUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    return Boolean(user);
  }
}
