import { Injectable } from '@nestjs/common';
import { AuditActorType, Prisma, UserStatus } from '@prisma/client';
import type { User } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import type { ListQuery } from '../../common/types/list-query-config.type';
import { PrismaService } from '../../prisma/prisma.service';
import { usersListConfig } from './query/users.list-config';

export type AuditEntry = {
  actorType: AuditActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata?: Record<string, string | number | boolean | null | string[]>;
};

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

  /**
   * The persisted identity behind every authenticated request: disabled,
   * pending-deletion, and soft-deleted accounts resolve to null, and the role
   * is read from the database, never from a token claim (SEC-009f, AUTH-002).
   */
  findActiveForAuth(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null, status: UserStatus.ACTIVE },
      select: { id: true, email: true, role: true },
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
    });
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

  /**
   * Sanitized audit evidence for sensitive actions (SEC-006): who did what to
   * which resource. Metadata holds only ids, counts, statuses, and field
   * names, never credentials, tokens, cookies, or email content.
   */
  recordAudit(entry: AuditEntry) {
    return this.createAuditLog({
      user: { connect: { id: entry.actorId } },
      actorType: entry.actorType,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata,
    });
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
