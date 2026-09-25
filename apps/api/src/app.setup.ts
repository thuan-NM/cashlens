import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Application, NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import {
  CORRELATION_HEADER,
  assignCorrelationId,
  correlationIdOf,
} from './common/http/correlation';
import { FieldValidationPipe } from './common/pipes/field-validation.pipe';

/**
 * Request handling shared by main.ts and the e2e harness, so the tests run
 * the same pipeline as production.
 */
export function configureApp(app: INestApplication): void {
  // X-Forwarded-* (and so request.secure and request.ip) are honoured only
  // from the validated TRUST_PROXY hops (OPS-009, research.md "TLS boundary").
  const trustProxy = (app.get(ConfigService).get<string>('TRUST_PROXY') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  (app.getHttpAdapter().getInstance() as Application).set(
    'trust proxy',
    trustProxy.length ? trustProxy : false,
  );

  // First: every request, including ones refused below, gets its
  // correlation id before anything can answer it (ERR-006).
  app.use(assignCorrelationId);
  app.use(rejectNulBytes);
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new FieldValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Safe errors with a stable code and the correlation id (ERR-001–ERR-006).
  app.useGlobalFilters(new ApiExceptionFilter());
}

/**
 * PostgreSQL text cannot contain NUL, so no stored identifier has one. A
 * request that carries one is answered like an absent resource instead of
 * failing inside the database with a 500 (SEC-007).
 */
const nulLogger = new Logger('RequestGuard');

function rejectNulBytes(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.originalUrl.includes('%00')) {
    const correlationId = correlationIdOf(request);
    // Refused before the request logger runs: the only log evidence.
    nulLogger.warn({
      event: 'request.rejected',
      correlationId,
      statusCode: 404,
      errorCode: 'NOT_FOUND',
      reason: 'NUL_BYTE',
      method: request.method,
    });
    response.setHeader(CORRELATION_HEADER, correlationId);
    response.status(404).json({
      statusCode: 404,
      message: 'Not Found',
      error: 'Not Found',
      code: 'NOT_FOUND',
      correlationId,
    });
    return;
  }
  next();
}
