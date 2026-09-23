import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

/**
 * E2E test database strategy (research.md "E2E test database strategy").
 *
 * - The shared test database comes from E2E_DATABASE_URL, never from
 *   DATABASE_URL, and its name must contain "test".
 * - Suites that assert global state get their own database,
 *   test_e2e_<suite>_<epochMs>, migrated with `prisma migrate deploy` and
 *   dropped afterwards. Databases rather than schemas: PrismaPg is built from
 *   the connection string alone, and node-postgres ignores `?schema=`.
 *
 * Connection strings are never printed; messages name the database only.
 */

const API_ROOT = join(__dirname, '..', '..');
const ISOLATED_DATABASE = /^test_e2e_[a-z0-9_]+_(\d{13})$/;
const STALE_SCHEMA = /^e2e_[a-z0-9_]*_(\d{13})$/;
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type IsolatedDatabase = { name: string; url: string };

/** E2E_DATABASE_URL from the environment, else from apps/api/.env. */
export function resolveE2eDatabaseUrl(): string {
  const url =
    process.env.E2E_DATABASE_URL?.trim() || readApiEnvFile('E2E_DATABASE_URL');
  if (!url) {
    throw new Error(
      'E2E_DATABASE_URL is not set. Point it at a dedicated test database whose name contains "test" (see apps/api/.env.example).',
    );
  }
  assertTestDatabaseUrl(url);
  return url;
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Refuses any database whose name does not contain "test". */
export function assertTestDatabaseUrl(url: string): void {
  let name: string;
  try {
    name = databaseName(url);
  } catch {
    throw new Error('The e2e database URL is not a valid postgresql:// URL.');
  }
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run e2e tests against database "${name}": its name must contain "test".`,
    );
  }
}

export function urlForDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(name)}`;
  return parsed.toString();
}

/** Creates the shared test database when it does not exist yet. */
export async function ensureDatabaseExists(url: string): Promise<void> {
  const name = databaseName(url);
  await withAdminClient(url, async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (!existing.rowCount) {
      await client.query(`CREATE DATABASE ${quoteIdent(name)}`);
    }
  });
}

/** Applies every migration with `prisma migrate deploy`. */
export function migrateDatabase(url: string): void {
  assertTestDatabaseUrl(url);
  const prismaCli = require.resolve('prisma/build/index.js', {
    paths: [API_ROOT],
  });
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const output = hidePasswords(
      `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
    throw new Error(
      `prisma migrate deploy failed for database "${databaseName(url)}" (exit ${result.status}).\n${output}`,
    );
  }
}

let lastEpochMs = 0;

/** Creates and migrates a private database for a suite that asserts global state. */
export async function createIsolatedDatabase(
  suite: string,
): Promise<IsolatedDatabase> {
  const base = resolveE2eDatabaseUrl();
  const slug =
    suite
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'suite';
  // Unique even when two databases are created within the same millisecond.
  lastEpochMs = Math.max(Date.now(), lastEpochMs + 1);
  const name = `test_e2e_${slug}_${lastEpochMs}`;
  await withAdminClient(base, (client) =>
    client.query(`CREATE DATABASE ${quoteIdent(name)}`),
  );
  const url = urlForDatabase(base, name);
  try {
    migrateDatabase(url);
  } catch (error) {
    await dropIsolatedDatabase(name);
    throw error;
  }
  return { name, url };
}

export async function dropIsolatedDatabase(name: string): Promise<void> {
  if (!ISOLATED_DATABASE.test(name)) {
    throw new Error(
      `Refusing to drop "${name}": not an isolated e2e database.`,
    );
  }
  await withAdminClient(resolveE2eDatabaseUrl(), (client) =>
    client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`),
  );
}

/** Drops test_e2e_* databases left behind by crashed runs (older than 24 hours). */
export async function dropStaleIsolatedDatabases(
  now = Date.now(),
): Promise<string[]> {
  return withAdminClient(resolveE2eDatabaseUrl(), async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'test\\_e2e\\_%'`,
    );
    const dropped: string[] = [];
    for (const { datname } of rows) {
      const match = ISOLATED_DATABASE.exec(datname);
      if (match && now - Number(match[1]) > STALE_AFTER_MS) {
        await client.query(
          `DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`,
        );
        dropped.push(datname);
      }
    }
    return dropped;
  });
}

/** Drops e2e_* schemas in the shared test database older than 24 hours. */
export async function dropStaleE2eSchemas(
  url: string,
  now = Date.now(),
): Promise<string[]> {
  assertTestDatabaseUrl(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'e2e\\_%'`,
    );
    const dropped: string[] = [];
    for (const { nspname } of rows) {
      const match = STALE_SCHEMA.exec(nspname);
      if (match && now - Number(match[1]) > STALE_AFTER_MS) {
        await client.query(
          `DROP SCHEMA IF EXISTS ${quoteIdent(nspname)} CASCADE`,
        );
        dropped.push(nspname);
      }
    }
    return dropped;
  } finally {
    await client.end();
  }
}

/** Lists isolated e2e databases that currently exist (used by harness checks). */
export async function listIsolatedDatabases(): Promise<string[]> {
  return withAdminClient(resolveE2eDatabaseUrl(), async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'test\\_e2e\\_%' ORDER BY datname`,
    );
    return rows.map((row) => row.datname);
  });
}

async function withAdminClient<T>(
  url: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  // Server-level statements run from the maintenance database.
  const client = new Client({
    connectionString: urlForDatabase(url, 'postgres'),
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function hidePasswords(text: string): string {
  return text.replace(/(:\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@');
}

function readApiEnvFile(key: string): string | undefined {
  const file = join(API_ROOT, '.env');
  if (!existsSync(file)) {
    return undefined;
  }
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  if (!line) {
    return undefined;
  }
  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, '$2') || undefined;
}
