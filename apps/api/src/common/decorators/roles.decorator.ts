import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles; enforced by RolesGuard, which must run
 * after JwtAuthGuard (SEC-002, SEC-003).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
