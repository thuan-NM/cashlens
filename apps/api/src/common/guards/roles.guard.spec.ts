import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY, Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

type StoredUser = { role: UserRole; status: UserStatus } | null;

// Route handlers as the guard sees them: one restricted to ADMIN, one open.
const adminOnly = () => undefined;
Roles(UserRole.ADMIN)(adminOnly);
const open = () => undefined;
class SomeController {}

function contextFor(
  handler: () => void,
  user?: { id: string; role?: string },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => SomeController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let stored: StoredUser;
  let findFirst: jest.Mock;
  let guard: RolesGuard;

  beforeEach(() => {
    stored = null;
    findFirst = jest.fn(() => Promise.resolve(stored));
    const prisma = { user: { findFirst } } as unknown as PrismaService;
    guard = new RolesGuard(new Reflector(), prisma);
  });

  it('stores the required roles as metadata', () => {
    expect(Reflect.getMetadata(ROLES_KEY, adminOnly)).toEqual([UserRole.ADMIN]);
  });

  it('allows an ACTIVE ADMIN, using the persisted role', async () => {
    stored = { role: UserRole.ADMIN, status: UserStatus.ACTIVE };
    // The token claim says USER; the persisted role decides (SEC-009f).
    await expect(
      guard.canActivate(contextFor(adminOnly, { id: 'u1', role: 'USER' })),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1', deletedAt: null } }),
    );
  });

  it('forbids a USER even when the token claims ADMIN', async () => {
    stored = { role: UserRole.USER, status: UserStatus.ACTIVE };
    await expect(
      guard.canActivate(contextFor(adminOnly, { id: 'u1', role: 'ADMIN' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([UserStatus.DISABLED, UserStatus.PENDING_DELETE])(
    'rejects a %s ADMIN as unauthenticated',
    async (status) => {
      stored = { role: UserRole.ADMIN, status };
      await expect(
        guard.canActivate(contextFor(adminOnly, { id: 'u1' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('rejects a deleted or missing account as unauthenticated', async () => {
    stored = null;
    await expect(
      guard.canActivate(contextFor(adminOnly, { id: 'gone' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a request without authentication', async () => {
    await expect(
      guard.canActivate(contextFor(adminOnly)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('allows a route without role metadata without querying the account', async () => {
    await expect(
      guard.canActivate(contextFor(open, { id: 'u1' })),
    ).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
