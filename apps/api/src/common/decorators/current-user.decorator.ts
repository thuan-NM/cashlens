import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestUser } from '../types/request-user.type';

/** The authenticated user that JwtAuthGuard attached to the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined =>
    ctx.switchToHttp().getRequest<{ user?: RequestUser }>().user,
);
