import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';

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

  updateTokens(
    id: string,
    data: Pick<
      Prisma.EmailConnectionUpdateInput,
      | 'accessTokenEncrypted'
      | 'refreshTokenEncrypted'
      | 'tokenExpiresAt'
      | 'status'
      | 'errorMessage'
    >,
  ) {
    return this.prisma.emailConnection.update({ where: { id }, data });
  }

  /** Owner-scoped (SEC-001); null when the caller owns no such connection. */
  disconnect(userId: string, id: string) {
    return nullIfNotFound(
      this.prisma.emailConnection.update({
        where: { id, userId, disconnectedAt: null },
        data: {
          status: 'REVOKED',
          disconnectedAt: new Date(),
          accessTokenEncrypted: '',
          refreshTokenEncrypted: '',
        },
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
