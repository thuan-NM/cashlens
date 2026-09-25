import './support/synthetic-env'; // must stay first: the spawned CLI inherits synthetic, valid configuration
import { ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { Client, QueryResultRow } from 'pg';
import { syntheticEmail } from './helpers/auth-fixtures';
import {
  createIsolatedDatabase,
  databaseName,
  dropIsolatedDatabase,
  resolveE2eDatabaseUrl,
  urlForDatabase,
} from './helpers/test-database';

/**
 * T013 [SEC-009, SC-015, AUTH-005]: the operator-run first-administrator
 * bootstrap CLI (src/scripts/bootstrap-admin.ts, package script
 * `admin:bootstrap`).
 *
 * Every case runs the real script as a child process against its own isolated
 * database (test_e2e_admin_bootstrap_<epochMs>), so the zero-admin
 * precondition holds regardless of the other suites that share the test
 * database. Users are seeded directly with SQL; nothing here promotes a user
 * any other way. After every case the shared test database is checked for
 * side effects, and every isolated database is dropped.
 *
 * Exit codes (research.md "Administrator bootstrap"): 0 promoted or already
 * admin; 2 target missing, disabled, pending deletion, soft-deleted, or not
 * self-registered; 3 another ACTIVE admin exists; 1 configuration, database,
 * or argument error.
 *
 * No output, assertion message, or failure excerpt may print a password hash,
 * a connection string, the database password, or a configured secret.
 */

const API_ROOT = join(__dirname, '..');
const SCRIPT = 'src/scripts/bootstrap-admin.ts';
const SPAWN_TIMEOUT_MS = 90_000;
const ONE_RUN_MS = 240_000;
const MANY_RUNS_MS = 480_000;
const HOOK_MS = 120_000;

const GRANTED = 'ADMIN_BOOTSTRAP_GRANTED';
const REVOKED = 'ADMIN_ROLE_REVOKED';
const SECRET_ENV_KEYS = [
  'JWT_SECRET',
  'EMAIL_TOKEN_ENCRYPTION_KEY',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_OAUTH_STATE_SECRET',
];
const BCRYPT_SHAPE = /\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}/;
const CREDENTIAL_URL = /postgres(?:ql)?:\/\/[^\s:/@]+:([^\s@]+)@/gi;
/** A masked password such as `user:***@host` is not a leak. */
const MASKED_PASSWORD = /^(?:\*+|x+|<redacted>|\[redacted\]|redacted)$/i;

type Role = 'USER' | 'ADMIN';
type Status = 'ACTIVE' | 'DISABLED' | 'PENDING_DELETE';

type SeedOptions = {
  role?: Role;
  status?: Status;
  deleted?: boolean;
  /** false seeds an account without a password hash (not self-registered). */
  selfRegistered?: boolean;
};

type SeededUser = { id: string; email: string };

type StoredUser = {
  id: string;
  email: string;
  hasPassword: boolean;
  role: Role;
  status: Status;
  deletedAt: Date | null;
  updatedAt: Date;
};

type AuditRow = {
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: string | null;
  metadata: unknown;
};

type RunResult = { code: number | null; output: string; timedOut: boolean };

type Forbidden = Array<{ label: string; value: string }>;

type SharedState = {
  cliAuditIds: string[];
  stableAdmins: Array<Record<string, unknown>>;
};

const liveChildren = new Set<ChildProcess>();
const createdDatabases = new Set<string>();
const seededEmails = new Set<string>();

// ---------------------------------------------------------------------------
// Running the CLI
// ---------------------------------------------------------------------------

/**
 * Spawns the script exactly like `yarn workspace api admin:bootstrap`
 * ("ts-node -r tsconfig-paths/register src/scripts/bootstrap-admin.ts"), with
 * the isolated database as DATABASE_URL.
 */
function runBootstrap(databaseUrl: string, args: string[]): Promise<RunResult> {
  if (!existsSync(join(API_ROOT, SCRIPT))) {
    // Node's own "Cannot find module" error also exits 1, which would make the
    // exit-1 cases pass for the wrong reason, so a missing script fails here.
    return Promise.reject(
      new Error(
        `T028 not implemented: ${SCRIPT} does not exist, so the admin:bootstrap CLI cannot run.`,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        SCRIPT,
        ...args,
      ],
      {
        cwd: API_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    liveChildren.add(child);
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, SPAWN_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve({ code, output, timedOut });
    });
  });
}

function killLiveChildren(): void {
  for (const child of liveChildren) {
    child.kill('SIGKILL');
  }
  liveChildren.clear();
}

function redact(text: string, forbidden: Forbidden): string {
  let result = text;
  for (const { value } of forbidden) {
    result = result.split(value).join('***');
  }
  return result
    .replace(/(:\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@')
    .replace(new RegExp(BCRYPT_SHAPE.source, 'g'), '***');
}

/** Fails with the exit code and a short, redacted excerpt of the output. */
function expectExit(
  result: RunResult,
  expected: number,
  forbidden: Forbidden,
): void {
  if (result.code === expected && !result.timedOut) {
    return;
  }
  const outcome = result.timedOut
    ? `timed out after ${SPAWN_TIMEOUT_MS} ms`
    : `exited with code ${String(result.code)}`;
  const excerpt = redact(result.output, forbidden).trim().slice(-500);
  throw new Error(
    `admin:bootstrap ${outcome}; expected exit ${expected}.\nOutput excerpt (redacted): ${excerpt || '<empty>'}`,
  );
}

/** Names the kind of leaked value without ever printing it. */
function expectNoSecrets(result: RunResult, forbidden: Forbidden): void {
  const leaks = forbidden
    .filter(({ value }) => result.output.includes(value))
    .map(({ label }) => label);
  if (BCRYPT_SHAPE.test(result.output)) {
    leaks.push('a bcrypt-shaped password hash');
  }
  const credentialUrls = [...result.output.matchAll(CREDENTIAL_URL)].filter(
    (match) => !MASKED_PASSWORD.test(match[1]),
  );
  if (credentialUrls.length) {
    leaks.push('a connection string with credentials');
  }
  if (leaks.length) {
    throw new Error(
      `admin:bootstrap output contains ${[...new Set(leaks)].join(', ')}.`,
    );
  }
}

/** Values no case may print: connection strings, the password, secrets. */
function globalForbidden(): Forbidden {
  const shared = resolveE2eDatabaseUrl();
  const parsed = new URL(shared);
  const list: Forbidden = [
    { label: 'the shared test database URL', value: shared },
    {
      label: 'the database password',
      value: decodeURIComponent(parsed.password),
    },
    { label: 'the database password', value: parsed.password },
  ];
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      list.push({ label: `the ${key} value`, value });
    }
  }
  return list.filter(({ value }) => value.length >= 6);
}

// ---------------------------------------------------------------------------
// Isolated databases
// ---------------------------------------------------------------------------

async function withClient<T>(
  url: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function queryRows<R extends QueryResultRow>(
  url: string,
  sql: string,
  params: unknown[] = [],
): Promise<R[]> {
  return withClient(
    url,
    async (client) => (await client.query<R>(sql, params)).rows,
  );
}

/** A synthetic, bcrypt-shaped hash generated per run (never a literal). */
function syntheticPasswordHash(): string {
  const body = randomBytes(40)
    .toString('base64url')
    .replace(/-/g, '.')
    .replace(/_/g, '/')
    .slice(0, 53);
  return ['', '2b', '10', body].join('$');
}

const USER_COLUMNS = `id, email, "passwordHash" IS NOT NULL AS "hasPassword",
  role::text AS role, status::text AS status, "deletedAt", "updatedAt"`;

class Sandbox {
  private readonly hashes: string[] = [];

  constructor(
    readonly name: string,
    readonly url: string,
  ) {}

  async seed(label: string, options: SeedOptions = {}): Promise<SeededUser> {
    const id = `c${randomBytes(12).toString('hex')}`;
    const email = syntheticEmail(`bootstrap-${label}`);
    const passwordHash =
      options.selfRegistered === false ? null : syntheticPasswordHash();
    if (passwordHash) {
      this.hashes.push(passwordHash);
    }
    seededEmails.add(email);
    // A fixed past updatedAt makes any write to the row visible.
    const past = new Date(Date.UTC(2025, 0, 2, 3, 4, 5));
    await queryRows(
      this.url,
      `INSERT INTO "User" (id, email, "passwordHash", role, status, "deletedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4::"UserRole", $5::"UserStatus", $6, $7, $7)`,
      [
        id,
        email,
        passwordHash,
        options.role ?? 'USER',
        options.status ?? 'ACTIVE',
        options.deleted ? past : null,
        past,
      ],
    );
    return { id, email };
  }

  async user(id: string): Promise<StoredUser | undefined> {
    const rows = await queryRows<StoredUser>(
      this.url,
      `SELECT ${USER_COLUMNS} FROM "User" WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  async userByEmail(email: string): Promise<StoredUser | undefined> {
    const rows = await queryRows<StoredUser>(
      this.url,
      `SELECT ${USER_COLUMNS} FROM "User" WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0];
  }

  async admins(): Promise<StoredUser[]> {
    return queryRows<StoredUser>(
      this.url,
      `SELECT ${USER_COLUMNS} FROM "User" WHERE role = 'ADMIN' ORDER BY id`,
    );
  }

  async auditRows(): Promise<AuditRow[]> {
    return queryRows<AuditRow>(
      this.url,
      `SELECT "actorType"::text AS "actorType", action, "resourceType",
              "resourceId", "userId", metadata
         FROM "AuditLog" ORDER BY "createdAt", id`,
    );
  }

  run(...args: string[]): Promise<RunResult> {
    return runBootstrap(this.url, args);
  }

  forbidden(): Forbidden {
    return [
      ...globalForbidden(),
      { label: 'the isolated database URL', value: this.url },
      ...this.hashes.map((value) => ({
        label: 'a seeded password hash',
        value,
      })),
    ];
  }
}

async function newSandbox(): Promise<Sandbox> {
  const database = await createIsolatedDatabase('admin_bootstrap');
  createdDatabases.add(database.name);
  const sandbox = new Sandbox(database.name, database.url);
  // Fresh database: zero administrators and no audit rows.
  expect(await sandbox.admins()).toEqual([]);
  expect(await sandbox.auditRows()).toEqual([]);
  return sandbox;
}

async function dropCreatedDatabases(): Promise<void> {
  const failures: string[] = [];
  for (const name of [...createdDatabases]) {
    try {
      await dropIsolatedDatabase(name);
      createdDatabases.delete(name);
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length) {
    throw new Error(
      `Could not drop isolated databases:\n${failures.join('\n')}`,
    );
  }
}

const grantedRow = (userId: string): AuditRow => ({
  actorType: 'SYSTEM',
  action: GRANTED,
  resourceType: 'user',
  resourceId: userId,
  userId: null,
  metadata: { source: 'cli' },
});

const revokedRow = (userId: string): AuditRow => ({
  actorType: 'SYSTEM',
  action: REVOKED,
  resourceType: 'user',
  resourceId: userId,
  userId: null,
  metadata: { source: 'cli' },
});

// ---------------------------------------------------------------------------
// Shared test database: must never be touched by the CLI runs
// ---------------------------------------------------------------------------

/**
 * Other suites promote and delete their own run-scoped @example.test
 * administrators concurrently, so only the administrators outside that domain
 * are compared, plus any CLI audit row written since the suite started.
 */
async function readSharedState(): Promise<SharedState> {
  const url = resolveE2eDatabaseUrl();
  const audits = await queryRows<{ id: string }>(
    url,
    `SELECT id FROM "AuditLog"
      WHERE "actorType" = 'SYSTEM' AND action = ANY($1::text[]) ORDER BY id`,
    [[GRANTED, REVOKED]],
  );
  const stableAdmins = await queryRows<Record<string, unknown>>(
    url,
    `SELECT id, role::text AS role, status::text AS status, "deletedAt", "updatedAt"
       FROM "User"
      WHERE role = 'ADMIN' AND email NOT LIKE '%@example.test'
      ORDER BY id`,
  );
  return { cliAuditIds: audits.map((row) => row.id), stableAdmins };
}

async function expectSharedDatabaseUntouched(
  baseline: SharedState,
): Promise<void> {
  const current = await readSharedState();
  const added = current.cliAuditIds.filter(
    (id) => !baseline.cliAuditIds.includes(id),
  );
  expect({ newCliAuditRowsInSharedDb: added.length }).toEqual({
    newCliAuditRowsInSharedDb: 0,
  });
  expect(current.stableAdmins).toEqual(baseline.stableAdmins);
  const [{ n }] = await queryRows<{ n: number }>(
    resolveE2eDatabaseUrl(),
    `SELECT count(*)::int AS n FROM "User" WHERE lower(email) = ANY($1::text[])`,
    [[...seededEmails]],
  );
  expect({ isolatedUsersFoundInSharedDb: n }).toEqual({
    isolatedUsersFoundInSharedDb: 0,
  });
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('Admin bootstrap CLI (T013, SEC-009, SC-015)', () => {
  let sharedBaseline: SharedState;

  beforeAll(async () => {
    sharedBaseline = await readSharedState();
  }, HOOK_MS);

  afterEach(async () => {
    killLiveChildren();
    try {
      await expectSharedDatabaseUntouched(sharedBaseline);
    } finally {
      await dropCreatedDatabases();
    }
  }, HOOK_MS);

  afterAll(async () => {
    killLiveChildren();
    await dropCreatedDatabases();
  }, HOOK_MS);

  describe('first promotion', () => {
    it(
      '--email promotes the only ACTIVE self-registered user: exit 0, role ADMIN, one sanitized SYSTEM audit row',
      async () => {
        const sandbox = await newSandbox();
        const target = await sandbox.seed('first');
        const bystander = await sandbox.seed('bystander');

        const result = await sandbox.run('--email', target.email);

        expectExit(result, 0, sandbox.forbidden());
        expectNoSecrets(result, sandbox.forbidden());
        expect(await sandbox.user(target.id)).toMatchObject({
          role: 'ADMIN',
          status: 'ACTIVE',
          deletedAt: null,
        });
        expect((await sandbox.user(bystander.id))?.role).toBe('USER');
        expect(await sandbox.auditRows()).toEqual([grantedRow(target.id)]);
      },
      ONE_RUN_MS,
    );

    it(
      'rerun for the same user is a no-op: exit 0, row untouched, no new audit row',
      async () => {
        const sandbox = await newSandbox();
        const target = await sandbox.seed('rerun');

        expectExit(
          await sandbox.run('--email', target.email),
          0,
          sandbox.forbidden(),
        );
        const afterFirst = await sandbox.user(target.id);
        expect(afterFirst?.role).toBe('ADMIN');

        const rerun = await sandbox.run('--email', target.email);

        expectExit(rerun, 0, sandbox.forbidden());
        expectNoSecrets(rerun, sandbox.forbidden());
        expect(await sandbox.user(target.id)).toEqual(afterFirst);
        expect(await sandbox.auditRows()).toEqual([grantedRow(target.id)]);
      },
      MANY_RUNS_MS,
    );
  });

  describe('refusal while an ACTIVE administrator exists', () => {
    it(
      'a different target is refused with exit 3 and nothing changes',
      async () => {
        const sandbox = await newSandbox();
        const first = await sandbox.seed('admin-first');
        const other = await sandbox.seed('admin-other');
        expectExit(
          await sandbox.run('--email', first.email),
          0,
          sandbox.forbidden(),
        );
        const otherBefore = await sandbox.user(other.id);
        const auditBefore = await sandbox.auditRows();

        const result = await sandbox.run('--email', other.email);

        expectExit(result, 3, sandbox.forbidden());
        expectNoSecrets(result, sandbox.forbidden());
        expect(await sandbox.user(other.id)).toEqual(otherBefore);
        expect((await sandbox.admins()).map((admin) => admin.id)).toEqual([
          first.id,
        ]);
        expect(await sandbox.auditRows()).toEqual(auditBefore);
      },
      MANY_RUNS_MS,
    );

    it(
      'DISABLED or soft-deleted administrators do not block bootstrap (break-glass recovery): exit 0',
      async () => {
        const sandbox = await newSandbox();
        const disabledAdmin = await sandbox.seed('disabled-admin', {
          role: 'ADMIN',
          status: 'DISABLED',
        });
        const deletedAdmin = await sandbox.seed('deleted-admin', {
          role: 'ADMIN',
          deleted: true,
        });
        const target = await sandbox.seed('recovery');
        const disabledBefore = await sandbox.user(disabledAdmin.id);
        const deletedBefore = await sandbox.user(deletedAdmin.id);

        const result = await sandbox.run('--email', target.email);

        expectExit(result, 0, sandbox.forbidden());
        expectNoSecrets(result, sandbox.forbidden());
        expect((await sandbox.user(target.id))?.role).toBe('ADMIN');
        expect(await sandbox.user(disabledAdmin.id)).toEqual(disabledBefore);
        expect(await sandbox.user(deletedAdmin.id)).toEqual(deletedBefore);
        expect(await sandbox.auditRows()).toEqual([grantedRow(target.id)]);
      },
      ONE_RUN_MS,
    );
  });

  describe('ineligible targets are refused with exit 2 and no change', () => {
    const ineligible: Array<[string, SeedOptions | null]> = [
      ['an email with no account', null],
      ['a DISABLED account', { status: 'DISABLED' }],
      ['a PENDING_DELETE account', { status: 'PENDING_DELETE' }],
      ['a soft-deleted account (deletedAt set)', { deleted: true }],
      [
        'a passwordless account that was not self-registered',
        { selfRegistered: false },
      ],
    ];

    it.each(ineligible)(
      '--email for %s exits 2; no ADMIN, no audit row, no account created',
      async (_case, options) => {
        const sandbox = await newSandbox();
        const unrelated = await sandbox.seed('unrelated');
        const unrelatedBefore = await sandbox.user(unrelated.id);
        let email: string;
        let before: StoredUser | undefined;
        if (options) {
          const target = await sandbox.seed('ineligible', options);
          email = target.email;
          before = await sandbox.user(target.id);
        } else {
          email = syntheticEmail('bootstrap-absent');
          seededEmails.add(email);
        }

        const result = await sandbox.run('--email', email);

        expectExit(result, 2, sandbox.forbidden());
        expectNoSecrets(result, sandbox.forbidden());
        expect(await sandbox.userByEmail(email)).toEqual(before);
        expect(await sandbox.user(unrelated.id)).toEqual(unrelatedBefore);
        expect(await sandbox.admins()).toEqual([]);
        expect(await sandbox.auditRows()).toEqual([]);
      },
      ONE_RUN_MS,
    );
  });

  describe('concurrency', () => {
    it(
      'two concurrent runs for two different ACTIVE targets leave exactly one ADMIN and one audit row (exit codes 0 and 3)',
      async () => {
        const sandbox = await newSandbox();
        const first = await sandbox.seed('race-a');
        const second = await sandbox.seed('race-b');

        // Both processes start before either is awaited.
        const runs = [
          sandbox.run('--email', first.email),
          sandbox.run('--email', second.email),
        ];
        const [firstResult, secondResult] = await Promise.all(runs);

        for (const result of [firstResult, secondResult]) {
          expectNoSecrets(result, sandbox.forbidden());
        }
        const codes = [firstResult.code, secondResult.code];
        if ([...codes].sort().join(',') !== '0,3') {
          const failing = firstResult.code === 0 ? secondResult : firstResult;
          expectExit(
            failing,
            firstResult.code === 0 ? 3 : 0,
            sandbox.forbidden(),
          );
        }
        const winner = firstResult.code === 0 ? first : second;
        const admins = await sandbox.admins();
        expect(admins.map((admin) => admin.id)).toEqual([winner.id]);
        expect(await sandbox.auditRows()).toEqual([grantedRow(winner.id)]);
      },
      MANY_RUNS_MS,
    );
  });

  describe('--list-admins (upgrade review, read-only)', () => {
    it(
      'lists every administrator by id, email, and status without credentials, and changes nothing',
      async () => {
        const sandbox = await newSandbox();
        const activeAdmin = await sandbox.seed('list-active', {
          role: 'ADMIN',
        });
        const disabledAdmin = await sandbox.seed('list-disabled', {
          role: 'ADMIN',
          status: 'DISABLED',
        });
        const plainUser = await sandbox.seed('list-user');
        const ids = [activeAdmin.id, disabledAdmin.id, plainUser.id];
        const before = await Promise.all(ids.map((id) => sandbox.user(id)));

        const result = await sandbox.run('--list-admins');

        expectExit(result, 0, sandbox.forbidden());
        expectNoSecrets(result, sandbox.forbidden());
        for (const admin of [activeAdmin, disabledAdmin]) {
          expect(result.output).toContain(admin.id);
          expect(result.output).toContain(admin.email);
        }
        expect(result.output).toContain('ACTIVE');
        expect(result.output).toContain('DISABLED');
        expect(result.output).not.toContain(plainUser.email);
        expect(await Promise.all(ids.map((id) => sandbox.user(id)))).toEqual(
          before,
        );
        expect(await sandbox.auditRows()).toEqual([]);
      },
      ONE_RUN_MS,
    );
  });

  describe('--revoke --email (upgrade review, audited)', () => {
    it(
      'demotes a pre-existing self-promoted ADMIN with one ADMIN_ROLE_REVOKED row, after which bootstrap succeeds',
      async () => {
        const sandbox = await newSandbox();
        const legacyAdmin = await sandbox.seed('legacy-admin', {
          role: 'ADMIN',
        });
        const target = await sandbox.seed('approved');

        const blocked = await sandbox.run('--email', target.email);
        expectExit(blocked, 3, sandbox.forbidden());
        expect((await sandbox.user(target.id))?.role).toBe('USER');

        const revoke = await sandbox.run(
          '--revoke',
          '--email',
          legacyAdmin.email,
        );

        expectExit(revoke, 0, sandbox.forbidden());
        expectNoSecrets(revoke, sandbox.forbidden());
        expect(await sandbox.user(legacyAdmin.id)).toMatchObject({
          role: 'USER',
          status: 'ACTIVE',
          deletedAt: null,
        });
        expect(await sandbox.auditRows()).toEqual([revokedRow(legacyAdmin.id)]);

        const bootstrap = await sandbox.run('--email', target.email);

        expectExit(bootstrap, 0, sandbox.forbidden());
        expectNoSecrets(bootstrap, sandbox.forbidden());
        expect((await sandbox.admins()).map((admin) => admin.id)).toEqual([
          target.id,
        ]);
        expect(await sandbox.auditRows()).toEqual([
          revokedRow(legacyAdmin.id),
          grantedRow(target.id),
        ]);
      },
      MANY_RUNS_MS,
    );

    it(
      '--revoke is a no-op for a USER (exit 0, no audit row) and refuses a missing target (exit 2)',
      async () => {
        const sandbox = await newSandbox();
        const plainUser = await sandbox.seed('revoke-user');
        const before = await sandbox.user(plainUser.id);
        const absent = syntheticEmail('bootstrap-revoke-absent');
        seededEmails.add(absent);

        const noop = await sandbox.run('--revoke', '--email', plainUser.email);

        expectExit(noop, 0, sandbox.forbidden());
        expectNoSecrets(noop, sandbox.forbidden());
        expect(await sandbox.user(plainUser.id)).toEqual(before);

        const missing = await sandbox.run('--revoke', '--email', absent);

        expectExit(missing, 2, sandbox.forbidden());
        expectNoSecrets(missing, sandbox.forbidden());
        expect(await sandbox.userByEmail(absent)).toBeUndefined();
        expect(await sandbox.auditRows()).toEqual([]);
      },
      MANY_RUNS_MS,
    );
  });

  describe('configuration, database, and argument errors (exit 1)', () => {
    it(
      'bad arguments exit 1 and change nothing (no args, --email without a value, --revoke without --email, unknown --force)',
      async () => {
        const sandbox = await newSandbox();
        const target = await sandbox.seed('bad-args');
        const before = await sandbox.user(target.id);
        const invocations = [
          [],
          ['--email'],
          ['--revoke'],
          ['--email', target.email, '--force'],
        ];

        for (const args of invocations) {
          const result = await sandbox.run(...args);
          expectExit(result, 1, sandbox.forbidden());
          expectNoSecrets(result, sandbox.forbidden());
        }

        expect(await sandbox.user(target.id)).toEqual(before);
        expect(await sandbox.admins()).toEqual([]);
        expect(await sandbox.auditRows()).toEqual([]);
      },
      MANY_RUNS_MS,
    );

    it(
      'an unreachable database exits 1 without printing the connection string or password',
      async () => {
        const shared = resolveE2eDatabaseUrl();
        const absentName = `test_e2e_admin_bootstrap_absent_${Date.now()}`;
        const absentUrl = urlForDatabase(shared, absentName);
        const email = syntheticEmail('bootstrap-unreachable');
        seededEmails.add(email);
        const forbidden: Forbidden = [
          ...globalForbidden(),
          { label: 'the target database URL', value: absentUrl },
        ];

        const result = await runBootstrap(absentUrl, ['--email', email]);

        expectExit(result, 1, forbidden);
        expectNoSecrets(result, forbidden);
        // The error class and its non-secret code (Prisma or SQLSTATE) make a
        // failure diagnosable, for example a transaction timeout (P2028).
        expect(result.output).toMatch(
          /Configuration or database error: \w+ \(code [A-Z0-9]{4,6}\)/,
        );
        expect(databaseName(absentUrl)).toBe(absentName);
        const [{ n }] = await queryRows<{ n: number }>(
          urlForDatabase(shared, 'postgres'),
          'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
          [absentName],
        );
        expect(n).toBe(0);
      },
      ONE_RUN_MS,
    );
  });
});
