import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
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

  disconnect(id: string) {
    return this.prisma.emailConnection.update({
      where: { id },
      data: {
        status: 'REVOKED',
        disconnectedAt: new Date(),
        accessTokenEncrypted: '',
        refreshTokenEncrypted: '',
      },
    });
  }
}
