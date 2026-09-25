import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ConfigValidationError } from './config/configuration';
import { buildPinoHttpOptions } from './common/logging/logging.config';
import { configureApp } from './app.setup';
import { CORRELATION_HEADER } from './common/http/correlation';
import { setupSwagger } from './swagger';

async function bootstrap() {
  // abortOnError: false makes a create-time failure (invalid configuration,
  // an unresolvable provider) reject here, so it is logged as one
  // structured app.start_failed event below instead of Nest's own dump.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  // SIGTERM/SIGINT close the app gracefully: providers' shutdown hooks run and
  // Prisma disconnects before the process exits (OPS-005).
  app.enableShutdownHooks();

  configureApp(app);

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:5173',
    credentials: true,
    // Lets the web app read the correlation id of a failed call (ERR-006).
    exposedHeaders: [CORRELATION_HEADER],
  });

  setupSwagger(app);

  await app.listen(process.env.PORT ?? 3000);
  app.get(Logger).log({
    event: 'app.started',
    nodeEnv: process.env.NODE_ENV,
    port: Number(process.env.PORT ?? 3000),
  });
}

/**
 * A failed start (invalid configuration, unreachable dependency at boot) is
 * logged as one structured, redacted event before the process exits. The
 * configuration error lists variable names and reasons, never values.
 */
bootstrap().catch((error: unknown) => {
  const options = buildPinoHttpOptions(undefined, false);
  pino({
    level: 'info',
    redact: options.redact,
    serializers: options.serializers,
    hooks: options.hooks,
  }).fatal({
    event: 'app.start_failed',
    errorName: error instanceof Error ? error.name : typeof error,
    configIssues:
      error instanceof ConfigValidationError
        ? error.issues.map((issue) => `${issue.key}: ${issue.reason}`)
        : undefined,
  });
  process.exit(1);
});
