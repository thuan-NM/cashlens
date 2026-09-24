import '../support/synthetic-env'; // must stay first: seeds config before AppModule loads
import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { createServer } from 'net';
import { join } from 'path';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { assertTestDatabaseUrl, resolveE2eDatabaseUrl } from './test-database';

const API_ROOT = join(__dirname, '..', '..');

/**
 * Builds the application the way main.ts does. Refuses to start unless
 * DATABASE_URL names a test database, so a developer database is never used
 * even when a suite runs outside the e2e global setup.
 */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication<App>> {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? '');

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) {
    builder = customize(builder);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app); // the same request pipeline as main.ts
  await app.init();
  return app;
}

export type ProductionServer = {
  /** http://127.0.0.1:<port>; Supertest connects from loopback. */
  baseUrl: string;
  stop: () => Promise<void>;
};

/**
 * Starts the real entry point, src/main.ts, as a separate production-mode
 * process (NODE_ENV=production) against the shared test database. A separate
 * process is required because configuration is validated when AppModule is
 * imported, and Prisma's query compiler cannot run twice in one process.
 *
 * Every production setting is synthetic and generated per run. The database
 * password travels in PGPASSWORD because production validation rejects the
 * documented development placeholder inside DATABASE_URL.
 */
export async function startProductionServer(
  overrides: Record<string, string> = {},
): Promise<ProductionServer> {
  const shared = new URL(resolveE2eDatabaseUrl());
  const password = decodeURIComponent(shared.password);
  shared.password = '';
  const secret = () => randomBytes(32).toString('base64url');
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    LOG_LEVEL: 'silent',
    DATABASE_URL: shared.toString(),
    PGPASSWORD: password,
    JWT_SECRET: secret(),
    JWT_EXPIRES_IN: '15m',
    EMAIL_TOKEN_ENCRYPTION_KEY: secret(),
    GMAIL_CLIENT_ID: 'e2e-production.apps.googleusercontent.test',
    GMAIL_CLIENT_SECRET: secret(),
    GMAIL_REDIRECT_URI:
      'https://cashlens.example.test/api/email-connections/gmail/callback',
    GMAIL_OAUTH_STATE_SECRET: secret(),
    CORS_ORIGIN: 'https://cashlens.example.test',
    APP_PUBLIC_URL: 'https://cashlens.example.test',
    TRUST_PROXY: 'loopback',
    COOKIE_SECURE: 'true',
    EMAIL_TRANSPORT: 'disabled',
    TS_NODE_TRANSPILE_ONLY: 'true',
    ...overrides,
  };
  assertTestDatabaseUrl(env.DATABASE_URL ?? '');

  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register', join('src', 'main.ts')],
    { cwd: API_ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitUntilReady(`${baseUrl}/api/health/ready`, child, 90_000);
  } catch (error) {
    await stopProcess(child);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\n${hidePasswords(stderr)}`);
  }
  return { baseUrl, stop: () => stopProcess(child) };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(
  url: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `The production server exited early (code ${child.exitCode}).`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The production server did not become ready in time.');
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

function hidePasswords(text: string): string {
  return text.replace(/(:\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@');
}
