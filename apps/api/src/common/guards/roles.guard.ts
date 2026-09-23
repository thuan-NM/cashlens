import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestUser } from '../types/request-user.type';

/**
 * Administrator authorization (SEC-002, SEC-003, SEC-005). It reads the
 * persisted role and status on every request, never the token claim, so a
 * promotion, demotion, or disablement takes effect on the next request
 * (SEC-009f). Use it after JwtAuthGuard: a missing session is a 401 before
 * any 403. It grants nothing on private data; ownership still applies (SEC-008).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }

    const userId = context.switchToHttp().getRequest<{ user?: RequestUser }>()
      .user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }

    const account = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true, status: true },
    });
    if (!account || account.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException();
    }
    if (!required.includes(account.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
