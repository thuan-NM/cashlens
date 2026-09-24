import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { databaseName, resolveE2eDatabaseUrl } from './test-database';

/**
 * Shared synthetic fixtures for the US1 suites (SEC-007, TEST-003, TEST-008).
 * Every identity is run-scoped under the reserved example.test domain, and
 * every credential is generated per run, so no real data or committed secret
 * is involved.
 */

export const RUN_ID = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

export type Agent = ReturnType<typeof request.agent>;

export type TestUser = {
  id: string;
  email: string;
  password: string;
  /** Cookie-carrying agent, signed in. */
  agent: Agent;
};

export type Envelope<T> = {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
};

export const dataOf = <T>(response: request.Response): T =>
  (response.body as Envelope<T>).data;

export function syntheticEmail(label: string): string {
  const suffix = randomBytes(3).toString('hex');
  return `${label}-${RUN_ID}-${suffix}@example.test`.toLowerCase();
}

export function syntheticPassword(): string {
  return `Pw-${randomBytes(12).toString('base64url')}-1a`;
}

/** Registers through the public API, then signs in with a cookie agent. */
export async function registerUser(
  app: INestApplication<App>,
  label: string,
): Promise<TestUser> {
  const email = syntheticEmail(label);
  const password = syntheticPassword();
  await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, fullName: `E2E ${label}` })
    .expect(201);
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  const me = await agent.get('/api/auth/me').expect(200);
  return { id: dataOf<{ id: string }>(me).id, email, password, agent };
}

/**
 * Test-only administrator promotion through Prisma. Allowed only in the shared
 * test database: isolated databases (the bootstrap suite) must reach an
 * administrator through the SEC-009 script alone.
 */
export async function promoteToAdminForTest(
  prisma: PrismaService,
  userId: string,
): Promise<void> {
  const current = databaseName(process.env.DATABASE_URL ?? '');
  if (current !== databaseName(resolveE2eDatabaseUrl())) {
    throw new Error(
      'Test-only admin promotion runs only in the shared test database.',
    );
  }
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
}

/** A well-formed identifier that no row has. */
export function absentId(): string {
  return `c${randomBytes(12).toString('hex')}`;
}

/** Identifiers that are not ids at all; path segments must be encoded. */
export const MALFORMED_IDS = [
  'not-a-valid-id',
  '0',
  "x' OR '1'='1",
  '..%2F..%2Fetc',
  'a'.repeat(300),
];

export const idPath = (id: string) => encodeURIComponent(id);

/**
 * Targeted cleanup: audit rows first (their user link is SET NULL on delete,
 * so they would otherwise outlive the user), then the users; owned rows
 * cascade.
 */
export async function cleanupUsers(
  prisma: PrismaService,
  userIds: Array<string | undefined>,
): Promise<void> {
  const ids = userIds.filter((id): id is string => Boolean(id));
  if (!ids.length) {
    return;
  }
  await prisma.auditLog.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { resourceId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
