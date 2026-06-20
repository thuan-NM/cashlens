import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import type { ListQuery } from '../../common/types/list-query-config.type';
import { PrismaService } from '../../prisma/prisma.service';
import { usersListConfig } from './query/users.list-config';

type UserWithPasswordHash = User & {
  passwordHash: string | null;
};

type UserSettingsPatch = Partial<
  Pick<
    Prisma.UserSettingsUncheckedCreateInput,
    | 'storeRawEmailBody'
    | 'allowAiInsights'
    | 'autoClassificationEnabled'
    | 'defaultMonthStartDay'
    | 'dataRetentionDays'
    | 'notificationEnabled'
    | 'metadata'
  >
>;

const userProfileInclude = {
  settings: true,
} satisfies Prisma.UserInclude;

@Injectable()
export class UsersRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listUsers(query: ListQuery) {
    return this.list(this.prisma.user, query, usersListConfig, {
      where: { deletedAt: null },
    });
  }

  findById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: userProfileInclude,
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        deletedAt: null,
      },
      include: userProfileInclude,
    });
  }

  findByEmailForAuth(email: string): Promise<UserWithPasswordHash | null> {
    return this.prisma.user.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        deletedAt: null,
      },
      include: userProfileInclude,
    }) as Promise<UserWithPasswordHash | null>;
  }

  create(data: Prisma.UserCreateInput & { passwordHash?: string | null }) {
    return this.prisma.user.create({
      data,
      include: userProfileInclude,
    });
  }

  updateById(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({
      where: { id },
      data,
      include: userProfileInclude,
    });
  }

  updateLastLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: {
        lastLoginAt: new Date(),
      },
      include: userProfileInclude,
    });
  }

  upsertSettings(userId: string, data: UserSettingsPatch) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
      },
      update: data,
    });
  }

  createAuditLog(data: Prisma.AuditLogCreateInput) {
    return this.prisma.auditLog.create({ data });
  }

  createRefreshToken(data: Prisma.RefreshTokenCreateInput) {
    return this.prisma.refreshToken.create({ data });
  }

  findActiveRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: {
          include: userProfileInclude,
        },
      },
    });
  }

  revokeRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  revokeAllRefreshTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  deleteById(id: string) {
    return super.baseDeleteById(this.prisma.user, id);
  }

  softDeleteById(id: string) {
    return super.baseSoftDeleteById(this.prisma.user, id);
  }
}
