import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TestUser,
  cleanupUsers,
  promoteToAdminForTest,
  registerUser,
} from './helpers/auth-fixtures';
import request from 'supertest';
import { createTestApp, startProductionServer } from './helpers/test-app';
import {
  assertTestDatabaseUrl,
  createIsolatedDatabase,
  databaseName,
  dropIsolatedDatabase,
  listIsolatedDatabases,
  resolveE2eDatabaseUrl,
  urlForDatabase,
} from './helpers/test-database';

// Self-test of the T010 harness: database guard, fixtures, isolated databases,
// and cleanup that leaves no residual rows.
describe('E2E harness (T010)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    alice = await registerUser(app, 'harness-alice');
    bob = await registerUser(app, 'harness-bob');
  });

  afterAll(async () => {
    await cleanupUsers(prisma, [alice?.id, bob?.id]);
    await app.close();
  });

  it('runs against the shared test database only', () => {
    const shared = databaseName(resolveE2eDatabaseUrl());
    expect(shared).toMatch(/test/i);
    expect(databaseName(process.env.DATABASE_URL ?? '')).toBe(shared);
    expect(() =>
      assertTestDatabaseUrl(
        urlForDatabase(resolveE2eDatabaseUrl(), 'cashlens_db'),
      ),
    ).toThrow(/must contain "test"/);
  });

  it('registers two distinct synthetic users with signed-in agents', async () => {
    expect(alice.id).not.toBe(bob.id);
    expect(alice.email).toMatch(/@example\.test$/);
    const me = await bob.agent.get('/api/auth/me').expect(200);
    expect((me.body as { data: { id: string } }).data.id).toBe(bob.id);
  });

  it('promotes a test administrator only in the shared database', async () => {
    await promoteToAdminForTest(prisma, bob.id);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: bob.id },
    });
    expect(stored.role).toBe('ADMIN');

    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urlForDatabase(
      resolveE2eDatabaseUrl(),
      'test_e2e_other_1700000000000',
    );
    try {
      await expect(promoteToAdminForTest(prisma, alice.id)).rejects.toThrow(
        /shared test database/,
      );
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  it('creates, migrates, and drops an isolated database', async () => {
    const isolated = await createIsolatedDatabase('harness');
    try {
      expect(isolated.name).toMatch(/^test_e2e_harness_\d{13}$/);
      const client = new Client({ connectionString: isolated.url });
      await client.connect();
      try {
        const users = await client.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM "User"',
        );
        expect(users.rows[0].n).toBe(0);
      } finally {
        await client.end();
      }
    } finally {
      await dropIsolatedDatabase(isolated.name);
    }
    expect(await listIsolatedDatabases()).not.toContain(isolated.name);
    await expect(dropIsolatedDatabase('cashlens_db')).rejects.toThrow(
      /not an isolated e2e database/,
    );
  });

  it('cleanup removes the users, their owned rows, and their audit rows', async () => {
    const carol = await registerUser(app, 'harness-carol');
    expect(
      await prisma.auditLog.count({ where: { userId: carol.id } }),
    ).toBeGreaterThan(0);
    await cleanupUsers(prisma, [carol.id]);
    expect(await prisma.user.count({ where: { id: carol.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { OR: [{ userId: carol.id }, { resourceId: carol.id }] },
      }),
    ).toBe(0);
  });

  it('starts the production entry point, which passes production validation', async () => {
    const server = await startProductionServer();
    try {
      await request(server.baseUrl).get('/api/health/ready').expect(200);
      await request(server.baseUrl).get('/api/health/live').expect(200);
    } finally {
      await server.stop();
    }
  }, 120_000);
});
