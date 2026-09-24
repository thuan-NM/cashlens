import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Application, NextFunction, Request, Response } from 'express';

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

  app.use(rejectNulBytes);
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

/**
 * PostgreSQL text cannot contain NUL, so no stored identifier has one. A
 * request that carries one is answered like an absent resource instead of
 * failing inside the database with a 500 (SEC-007).
 */
function rejectNulBytes(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (request.originalUrl.includes('%00')) {
    response
      .status(404)
      .json({ statusCode: 404, message: 'Not Found', error: 'Not Found' });
    return;
  }
  next();
}
