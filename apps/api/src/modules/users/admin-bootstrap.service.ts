import { Injectable } from '@nestjs/common';
import { AuditActorType, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Serializes every bootstrap and revoke run (data-model.md "Administrator provisioning"). */
const ADMIN_BOOTSTRAP_LOCK = 734_202_609;

export type PromoteOutcome =
  | 'PROMOTED'
  | 'ALREADY_ADMIN'
  | 'TARGET_INVALID'
  | 'ADMIN_EXISTS';

export type RevokeOutcome = 'REVOKED' | 'NOT_ADMIN' | 'TARGET_INVALID';

export type AdminSummary = {
  id: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
};

/**
 * Operator-only first-administrator provisioning (SEC-009). It never creates
 * an account and never handles a credential: it promotes an existing, ACTIVE,
 * self-registered account while no active administrator exists.
 */
@Injectable()
export class AdminBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

  promote(email: string): Promise<PromoteOutcome> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_LOCK})`;

      const target = await tx.user.findFirst({
        where: { email: normalize(email) },
        select: {
          id: true,
          role: true,
          status: true,
          deletedAt: true,
          passwordHash: true,
        },
      });
      // Self-registered means the account signs in with its own password.
      if (
        !target ||
        target.deletedAt ||
        target.status !== UserStatus.ACTIVE ||
        !target.passwordHash
      ) {
        return 'TARGET_INVALID';
      }
      if (target.role === UserRole.ADMIN) {
        return 'ALREADY_ADMIN';
      }

      const activeAdmins = await tx.user.count({
        where: {
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      });
      if (activeAdmins > 0) {
        return 'ADMIN_EXISTS';
      }

      await tx.user.update({
        where: { id: target.id },
        data: { role: UserRole.ADMIN },
      });
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          action: 'ADMIN_BOOTSTRAP_GRANTED',
          resourceType: 'user',
          resourceId: target.id,
          metadata: { source: 'cli' },
        },
      });
      return 'PROMOTED';
    });
  }

  revoke(email: string): Promise<RevokeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_LOCK})`;

      const target = await tx.user.findFirst({
        where: { email: normalize(email), deletedAt: null },
        select: { id: true, role: true },
      });
      if (!target) {
        return 'TARGET_INVALID';
      }
      if (target.role !== UserRole.ADMIN) {
        return 'NOT_ADMIN';
      }

      await tx.user.update({
        where: { id: target.id },
        data: { role: UserRole.USER },
      });
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          action: 'ADMIN_ROLE_REVOKED',
          resourceType: 'user',
          resourceId: target.id,
          metadata: { source: 'cli' },
        },
      });
      return 'REVOKED';
    });
  }

  listAdmins(): Promise<AdminSummary[]> {
    return this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
