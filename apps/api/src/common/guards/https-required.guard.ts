import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Production-only TLS boundary for authentication and session-issuing routes
 * (OPS-009, AUTH-003). `request.secure` honours X-Forwarded-Proto only from
 * the hops trusted by TRUST_PROXY, so a request that reaches the API over
 * plain HTTP, bypassing the operator's proxy, is refused with 403
 * HTTPS_REQUIRED. Health checks never use this guard.
 */
@Injectable()
export class HttpsRequiredGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('NODE_ENV') !== 'production') {
      return true;
    }
    if (context.switchToHttp().getRequest<Request>().secure) {
      return true;
    }
    // The global error filter (T064) comes later, so the code is set here.
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'HTTPS is required',
      code: 'HTTPS_REQUIRED',
    });
  }
}
