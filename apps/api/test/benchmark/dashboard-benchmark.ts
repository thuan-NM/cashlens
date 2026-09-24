/**
 * DASH-004 reference dashboard benchmark (SC-010, T036): seeder and runner.
 * The data set is dashboard-bench.fixture.ts; the procedure is research.md
 * "Dashboard benchmark (DASH-004, SC-010)" and quickstart.md §7b. The gating
 * run belongs to T101 on the reference release host; any other run is
 * informative only.
 *
 * seed — loads the fixture into a dedicated benchmark database.
 *
 *   yarn workspace api bench:dashboard:seed --env-file .env.release-test [--anchor YYYY-MM-DD]
 *   yarn workspace api bench:dashboard:seed [--anchor YYYY-MM-DD]   (with BENCH_DATABASE_URL set)
 *
 *   - `--env-file` reads POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB
 *     from the profile and connects to 127.0.0.1:55432, where
 *     docker-compose.bench.yml publishes the benchmark stack's PostgreSQL. A
 *     relative path is resolved against the current directory, then the
 *     repository root (`yarn workspace` runs scripts from apps/api).
 *   - Otherwise BENCH_DATABASE_URL names the database (local and test runs);
 *     its database name must contain "bench" or "test".
 *   - BENCH_USER_PASSWORD (required, 12–72 characters) becomes the password of
 *     bench@cashlens.test, hashed with bcrypt cost 12 like registration.
 *   - It refuses when the database holds any account other than
 *     bench@cashlens.test. Re-running replaces the previous bench user and
 *     every record it owns, in one database transaction.
 *   - It prints the anchor, record counts, and expected current-month totals,
 *     never the connection string or the password.
 *   - Exit codes: 0 seeded; 1 usage, configuration, or database error;
 *     2 refused (other accounts present, or a BENCH_DATABASE_URL database
 *     whose name lacks "bench"/"test").
 *
 * run — measures dashboard loads against a running API.
 *
 *   yarn workspace api bench:dashboard --base-url https://<release-test-host>/api
 *       [--anchor YYYY-MM-DD] [--email bench@cashlens.test] [--warmup 10] [--loads 200]
 *
 *   1. Waits (bounded) for GET <base>/health/ready to return 200.
 *   2. Signs in once (POST <base>/auth/login) with BENCH_USER_PASSWORD and
 *      carries the returned cookies like a browser: each goes only to paths
 *      under its Path attribute, so dashboard requests send the access cookie.
 *   3. Regenerates the fixture for `--anchor` (default: today in
 *      Asia/Ho_Chi_Minh; it must fall in the seeding anchor's month, whose
 *      expected totals do not depend on the day) and checks that
 *      GET <base>/dashboard/overview reports exactly its expected month,
 *      period, base-currency totals, per-currency groups, and eligible count.
 *   4. Runs `--warmup` unmeasured loads, then `--loads` measured loads one at a
 *      time. One load is the six requests DashboardPage.tsx issues for the
 *      current month (no month parameter), sent concurrently and timed with
 *      performance.now() from the first send to the last body received. Every
 *      response must be HTTP 200 with `success: true`.
 *   5. Prints min, median, p95, and max (nearest rank: the ⌈p·n⌉-th sorted
 *      value, so p95 of 200 loads is the 190th), failures, and the host the
 *      runner executes on (on the reference host, the same machine as the
 *      stack), plus one `RESULT {…}` JSON line for release evidence.
 *
 *   - Node's built-in fetch keeps connections alive between loads.
 *   - A private or test CA is trusted by starting the runner with
 *     NODE_EXTRA_CA_CERTS=<path-to-ca.pem>; Node's fetch honours it.
 *   - The runner never sends X-Forwarded-* headers. In production, sign-in
 *     requires the TLS proxy origin; a direct http:// call gets 403
 *     HTTPS_REQUIRED.
 *   - Exit codes: 0 pass (all responses succeeded, totals matched, p95 at
 *     most 1,000 ms); 1 p95 over 1,000 ms; 2 usage or configuration error;
 *     3 overview totals differ from the fixture; 4 a failed response
 *     (including readiness never reached and a failed sign-in).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import { isAbsolute, join, resolve } from 'path';
import { performance } from 'perf_hooks';
import {
  BENCH_EMAIL,
  BENCH_SEED,
  DashboardBenchFixture,
  ExpectedOverview,
  benchToday,
  generateDashboardBenchFixture,
} from './dashboard-bench.fixture';

export const BENCH_DB_HOST = '127.0.0.1';
export const BENCH_DB_PORT = 55432;
export const P95_LIMIT_MS = 1000;
/** The six requests of one DashboardPage.tsx load, current month. */
export const DASHBOARD_LOAD_PATHS = [
  '/dashboard/overview',
  '/dashboard/cashflow?months=6',
  '/dashboard/category-breakdown',
  '/dashboard/recent-transactions',
  '/dashboard/hot-budgets',
  '/dashboard/insights',
] as const;

/** Same cost as AuthService registration. */
const BCRYPT_COST = 12;
const INSERT_CHUNK = 500;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72; // bcrypt uses at most 72 bytes
const REQUEST_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 2_000;
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const USAGE = [
  'Usage:',
  '  dashboard-benchmark seed [--env-file <profile>] [--anchor YYYY-MM-DD]',
  '  dashboard-benchmark run --base-url <url> [--anchor YYYY-MM-DD] [--email <email>] [--warmup N] [--loads N]',
  'Environment: BENCH_USER_PASSWORD (both); BENCH_DATABASE_URL (seed without --env-file).',
].join('\n');

type Log = (line: string) => void;

// --- shared helpers -----------------------------------------------------------------

class UsageError extends Error {}

/** Raised when the target database must not be seeded. */
export class BenchRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchRefusedError';
  }
}

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Removes every secret (and any URL password) from text meant for output. */
const scrub = (text: string, secrets: Array<string | undefined>) => {
  let result = text.replace(/(:\/\/[^:/@\s]+:)[^@\s]*@/g, '$1***@');
  for (const secret of secrets) {
    if (secret) {
      result = result
        .split(secret)
        .join('***')
        .split(encodeURIComponent(secret))
        .join('***');
    }
  }
  return result;
};

function parseFlags(args: string[], allowed: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !allowed.includes(match[1])) {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
    const value = match[2] ?? args[++index];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new UsageError(`--${match[1]} needs a value.`);
    }
    flags[match[1]] = value;
  }
  return flags;
}

function integerFlag(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new UsageError(`--${name} must be an integer of at least ${min}.`);
  }
  return parsed;
}

function benchPassword(): string {
  const password = process.env.BENCH_USER_PASSWORD ?? '';
  if (
    password.length < PASSWORD_MIN ||
    Buffer.byteLength(password) > PASSWORD_MAX
  ) {
    throw new UsageError(
      `BENCH_USER_PASSWORD must be set to ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`,
    );
  }
  return password;
}

function anchorFlag(value: string | undefined): string {
  const anchor = value ?? benchToday(new Date());
  try {
    // Validates the date; the fixture itself is regenerated where needed.
    generateDashboardBenchFixture(anchor);
  } catch (error) {
    throw new UsageError(describeError(error));
  }
  return anchor;
}

// --- seeder -------------------------------------------------------------------------

export type SeedCounts = {
  users: number;
  categories: number;
  accounts: number;
  budgets: number;
  transactions: number;
};

/**
 * Replaces the bench user and its records with the fixture, in one
 * transaction. Refuses a database that holds any other account.
 */
export async function seedDashboardBench(
  db: PrismaClient,
  fixture: DashboardBenchFixture,
  passwordHash: string,
): Promise<SeedCounts> {
  // Originals first, so every duplicate reference points at an inserted row.
  const transactions = [
    ...fixture.transactions.filter((row) => !row.duplicateOfTransactionId),
    ...fixture.transactions.filter((row) => row.duplicateOfTransactionId),
  ];
  return db.$transaction(
    async (tx) => {
      const others = await tx.user.count({
        where: { email: { not: fixture.user.email } },
      });
      if (others > 0) {
        throw new BenchRefusedError(
          `Refusing to seed: the target database holds ${others} account(s) other than ${fixture.user.email}. Use a dedicated benchmark database.`,
        );
      }
      // Cascades to the previous run's settings, accounts, categories,
      // budgets, transactions, and sessions.
      await tx.user.deleteMany({ where: { email: fixture.user.email } });
      await tx.user.createMany({ data: [{ ...fixture.user, passwordHash }] });
      await tx.userSettings.createMany({ data: [fixture.settings] });
      await tx.financialAccount.createMany({ data: fixture.accounts });
      await tx.transactionCategory.createMany({ data: fixture.categories });
      await tx.budget.createMany({ data: fixture.budgets });
      for (let start = 0; start < transactions.length; start += INSERT_CHUNK) {
        await tx.transaction.createMany({
          data: transactions.slice(start, start + INSERT_CHUNK),
        });
      }

      const userId = fixture.user.id;
      return {
        users: await tx.user.count({ where: { email: fixture.user.email } }),
        categories: await tx.transactionCategory.count({ where: { userId } }),
        accounts: await tx.financialAccount.count({ where: { userId } }),
        budgets: await tx.budget.count({ where: { userId } }),
        transactions: await tx.transaction.count({ where: { userId } }),
      };
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
}

type SeedTarget = { url: string; database: string; source: string };

function readEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    const equals = line.indexOf('=');
    if (!line || line.startsWith('#') || equals <= 0) {
      continue;
    }
    const key = line
      .slice(0, equals)
      .trim()
      .replace(/^export\s+/, '');
    values[key] = line
      .slice(equals + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function resolveEnvFile(path: string): string {
  if (isAbsolute(path)) {
    if (existsSync(path)) {
      return path;
    }
  } else {
    const bases = [process.cwd(), process.env.PROJECT_CWD, REPO_ROOT];
    for (const base of bases) {
      const candidate = base ? resolve(base, path) : '';
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new UsageError(
    `Env file not found: ${path} (looked in the current directory and the repository root).`,
  );
}

function seedTarget(envFile: string | undefined): SeedTarget {
  if (envFile) {
    const values = readEnvFile(resolveEnvFile(envFile));
    const missing = [
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
    ].filter((key) => !values[key]);
    if (missing.length) {
      throw new UsageError(`The env file does not set ${missing.join(', ')}.`);
    }
    const credentials = `${encodeURIComponent(values.POSTGRES_USER)}:${encodeURIComponent(values.POSTGRES_PASSWORD)}`;
    return {
      url: `postgresql://${credentials}@${BENCH_DB_HOST}:${BENCH_DB_PORT}/${encodeURIComponent(values.POSTGRES_DB)}?schema=public`,
      database: values.POSTGRES_DB,
      source: `the ${envFile} profile, ${BENCH_DB_HOST}:${BENCH_DB_PORT}`,
    };
  }

  const url = process.env.BENCH_DATABASE_URL?.trim();
  if (!url) {
    throw new UsageError(
      'Pass --env-file <profile> or set BENCH_DATABASE_URL.',
    );
  }
  let database: string;
  try {
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
      throw new Error('not postgresql');
    }
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new UsageError('BENCH_DATABASE_URL is not a postgresql:// URL.');
  }
  if (!/bench|test/i.test(database)) {
    throw new BenchRefusedError(
      `Refusing to seed database "${database}": with BENCH_DATABASE_URL its name must contain "bench" or "test".`,
    );
  }
  return { url, database, source: 'BENCH_DATABASE_URL' };
}

async function seedCommand(args: string[], log: Log): Promise<number> {
  let target: SeedTarget | undefined;
  let password: string | undefined;
  try {
    const flags = parseFlags(args, ['env-file', 'anchor']);
    password = benchPassword();
    const anchor = anchorFlag(flags.anchor);
    target = seedTarget(flags['env-file']);
    const fixture = generateDashboardBenchFixture(anchor);

    log(
      `Seeding the DASH-004 fixture (seed ${fixture.seed}, anchor ${fixture.anchor}) into database "${target.database}" (${target.source}).`,
    );
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: target.url }),
    });
    let counts: SeedCounts;
    try {
      counts = await seedDashboardBench(db, fixture, passwordHash);
    } finally {
      await db.$disconnect();
    }

    const months = fixture.months;
    log(`Anchor: ${fixture.anchor} (Asia/Ho_Chi_Minh)`);
    log(
      `Months: ${months.length} (${months[0].key} to ${months[months.length - 1].key}; current ${fixture.expected.month})`,
    );
    log(
      `Seeded: ${counts.users} user (${fixture.user.email}), ${counts.categories} categories, ${counts.accounts} accounts, ${counts.budgets} budgets, ${counts.transactions} transactions.`,
    );
    for (const line of expectedTotalsLines(fixture)) {
      log(line);
    }
    log(
      `Run the benchmark during ${fixture.expected.month} (any --anchor day of that month verifies the same totals): bench:dashboard --base-url <url> --anchor ${fixture.anchor}`,
    );
    return 0;
  } catch (error) {
    const message = scrub(describeError(error), [target?.url, password]);
    if (error instanceof BenchRefusedError) {
      console.error(message);
      return 2;
    }
    if (error instanceof UsageError) {
      console.error(`${message}\n${USAGE}`);
      return 1;
    }
    console.error(`Seeding failed: ${message}`);
    return 1;
  }
}

function expectedTotalsLines(fixture: DashboardBenchFixture): string[] {
  const { expected } = fixture;
  return [
    `Expected current month ${expected.month} [${expected.periodStart}, ${expected.periodEnd}): ${expected.totalCount} records, ${expected.eligibleCount} eligible`,
    ...expected.overview.currencies.map(
      (group) =>
        `  ${group.currency}: income ${group.income}, expense ${group.expense}, net ${group.netCashflow}, eligible ${group.transactionCount}`,
    ),
  ];
}

// --- runner -------------------------------------------------------------------------

export type LoadStats = {
  count: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

export type BenchmarkOptions = {
  baseUrl: string;
  email: string;
  password: string;
  anchor: string;
  warmup: number;
  loads: number;
  readyTimeoutMs?: number;
  log?: Log;
};

export type BenchmarkResult = {
  exitCode: 0 | 1 | 3 | 4;
  totalsMatched: boolean;
  totalsMismatches: string[];
  warmupFailures: string[];
  failures: string[];
  durationsMs: number[];
  stats: LoadStats | null;
};

/** Nearest rank: the ⌈p·n⌉-th value of an ascending list. */
export const nearestRank = (sorted: number[], percentile: number): number =>
  sorted[
    Math.min(
      sorted.length,
      Math.max(1, Math.ceil(percentile * sorted.length)),
    ) - 1
  ];

export function loadStats(durationsMs: number[]): LoadStats {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    minMs: sorted[0],
    medianMs: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

type Envelope = { success?: unknown; data?: unknown };

const parseEnvelope = (text: string): Envelope | null => {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

const toMinor = (value: unknown) =>
  typeof value === 'number' ? Math.round(value * 100) : Number.NaN;

/** Differences between an overview body and the fixture's expected totals. */
export function compareOverview(
  actual: unknown,
  expected: ExpectedOverview,
): string[] {
  const body = (actual ?? {}) as Partial<
    Record<keyof ExpectedOverview, unknown>
  >;
  const problems: string[] = [];
  const same = (label: string, got: unknown, want: unknown) => {
    if (got !== want) {
      problems.push(
        `${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
      );
    }
  };
  const money = (label: string, got: unknown, want: number) => {
    if (toMinor(got) !== Math.round(want * 100)) {
      problems.push(`${label}: expected ${want}, got ${JSON.stringify(got)}`);
    }
  };

  same('month', body.month, expected.month);
  same('currency', body.currency, expected.currency);
  same('periodStart', body.periodStart, expected.periodStart);
  same('periodEnd', body.periodEnd, expected.periodEnd);
  same('timeZone', body.timeZone, expected.timeZone);
  money('income', body.income, expected.income);
  money('expense', body.expense, expected.expense);
  money('netCashflow', body.netCashflow, expected.netCashflow);
  same('transactionCount', body.transactionCount, expected.transactionCount);

  const groups = Array.isArray(body.currencies)
    ? (body.currencies as Array<Record<string, unknown>>)
    : null;
  if (!groups) {
    problems.push('currencies: missing');
    return problems;
  }
  same(
    'currencies',
    groups.map((group) => group?.currency).join(','),
    expected.currencies.map((group) => group.currency).join(','),
  );
  expected.currencies.forEach((want, index) => {
    const got = groups[index] ?? {};
    if (got.currency !== want.currency) {
      return;
    }
    const label = `currencies[${want.currency}]`;
    money(`${label}.income`, got.income, want.income);
    money(`${label}.expense`, got.expense, want.expense);
    money(`${label}.netCashflow`, got.netCashflow, want.netCashflow);
    same(
      `${label}.transactionCount`,
      got.transactionCount,
      want.transactionCount,
    );
  });
  return problems;
}

type StoredCookie = { pair: string; path: string };

const parseSetCookie = (header: string): StoredCookie | null => {
  const [pair, ...attributes] = header.split(';').map((part) => part.trim());
  if (!pair?.includes('=') || pair.endsWith('=')) {
    return null;
  }
  const path = attributes.find((attribute) => /^path=/i.test(attribute));
  return { pair, path: path ? path.slice(5) || '/' : '/' };
};

/** The Cookie header a browser would send to `url` (RFC 6265 path match). */
const cookieHeaderFor = (jar: StoredCookie[], url: URL) =>
  jar
    .filter(
      ({ path }) =>
        url.pathname === path ||
        url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`),
    )
    .map(({ pair }) => pair)
    .join('; ');

async function waitUntilReady(
  base: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${base}/health/ready`, {
        signal: AbortSignal.timeout(5_000),
      });
      await response.arrayBuffer();
      if (response.status === 200) {
        return true;
      }
    } catch {
      // Not reachable yet.
    }
    if (Date.now() + READY_POLL_MS > deadline) {
      return false;
    }
    await new Promise((done) => setTimeout(done, READY_POLL_MS));
  }
}

async function signIn(
  base: string,
  email: string,
  password: string,
): Promise<{ jar: StoredCookie[] } | { failure: string }> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    return { failure: `sign-in request failed: ${describeError(error)}` };
  }
  if (response.status !== 200 || parseEnvelope(text)?.success !== true) {
    const hint =
      response.status === 403
        ? ' (production sign-in requires the TLS proxy origin, e.g. https://<release-test-host>/api)'
        : '';
    return { failure: `sign-in failed: HTTP ${response.status}${hint}` };
  }
  const jar = response.headers
    .getSetCookie()
    .map(parseSetCookie)
    .filter((cookie): cookie is StoredCookie => cookie !== null);
  if (!jar.some((cookie) => cookie.pair.startsWith('accessToken='))) {
    return { failure: 'sign-in returned no accessToken cookie' };
  }
  return { jar };
}

async function getJson(
  url: URL,
  jar: StoredCookie[],
): Promise<{ status: number; body: Envelope | null; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Cookie: cookieHeaderFor(jar, url),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      status: response.status,
      body: parseEnvelope(await response.text()),
    };
  } catch (error) {
    return { status: 0, body: null, error: describeError(error) };
  }
}

/** One dashboard load: the six requests at once, timed until the last body. */
async function dashboardLoad(
  urls: URL[],
  jar: StoredCookie[],
): Promise<{ durationMs: number; failures: string[] }> {
  const requests = urls.map((url) => ({
    url,
    init: {
      headers: {
        Accept: 'application/json',
        Cookie: cookieHeaderFor(jar, url),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  }));
  const started = performance.now();
  const responses = await Promise.all(
    requests.map(async ({ url, init }) => {
      try {
        const response = await fetch(url, init);
        return { url, status: response.status, text: await response.text() };
      } catch (error) {
        return { url, status: 0, text: '', error: describeError(error) };
      }
    }),
  );
  const durationMs = performance.now() - started;

  const failures = responses
    .filter(
      (response) =>
        response.status !== 200 ||
        parseEnvelope(response.text)?.success !== true,
    )
    .map(
      (response) =>
        `${response.url.pathname}${response.url.search}: ${'error' in response ? response.error : `HTTP ${response.status}${response.status === 200 ? ' without success: true' : ''}`}`,
    );
  return { durationMs, failures };
}

const ms = (value: number) => `${value.toFixed(1)} ms`;
const round1 = (value: number) => Math.round(value * 10) / 10;

export function hostDescription(baseUrl: string): string {
  const cpus = os.cpus();
  const memoryGiB = os.totalmem() / 1024 ** 3;
  return [
    `${cpus[0]?.model.trim() ?? 'unknown CPU'} (${cpus.length} logical CPUs)`,
    `${memoryGiB.toFixed(1)} GiB RAM`,
    `${os.platform()} ${os.release()} ${os.arch()}`,
    `Node ${process.version}`,
    `target ${new URL(baseUrl).origin}`,
  ].join(', ');
}

/** The DASH-004 procedure. Never exits the process; returns the exit code. */
export async function runDashboardBenchmark(
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const base = options.baseUrl.replace(/\/+$/, '');
  const fixture = generateDashboardBenchFixture(options.anchor);
  const result: BenchmarkResult = {
    exitCode: 4,
    totalsMatched: false,
    totalsMismatches: [],
    warmupFailures: [],
    failures: [],
    durationsMs: [],
    stats: null,
  };

  log('DASH-004 dashboard benchmark');
  log(`  Host:    ${hostDescription(base)}`);
  log(
    `  Fixture: seed ${fixture.seed}, anchor ${fixture.anchor}, current month ${fixture.expected.month}, user ${options.email}`,
  );
  log(
    `  Plan:    ${options.warmup} warm-up + ${options.loads} measured sequential loads of ${DASHBOARD_LOAD_PATHS.length} concurrent requests`,
  );

  if (
    !(await waitUntilReady(base, options.readyTimeoutMs ?? READY_TIMEOUT_MS))
  ) {
    result.failures.push('readiness: /health/ready never returned 200');
    log('Readiness: FAILED (/health/ready never returned 200)');
    return result;
  }
  log('Readiness: ready');

  const session = await signIn(base, options.email, options.password);
  if ('failure' in session) {
    result.failures.push(session.failure);
    log(`Sign-in: FAILED (${session.failure})`);
    return result;
  }
  log('Sign-in: ok (once)');

  const overview = await getJson(
    new URL(`${base}/dashboard/overview`),
    session.jar,
  );
  if (overview.status !== 200 || overview.body?.success !== true) {
    const failure = `overview check: ${overview.error ?? `HTTP ${overview.status}`}`;
    result.failures.push(failure);
    log(`Totals: FAILED (${failure})`);
    return result;
  }
  result.totalsMismatches = compareOverview(
    overview.body.data,
    fixture.expected.overview,
  );
  if (result.totalsMismatches.length) {
    result.exitCode = 3;
    log(
      'Totals: MISMATCH with the fixture (was the database seeded for this anchor month, and is the API clock in that month?)',
    );
    for (const problem of result.totalsMismatches) {
      log(`  ${problem}`);
    }
    return result;
  }
  result.totalsMatched = true;
  log('Totals: match the fixture');
  for (const line of expectedTotalsLines(fixture)) {
    log(`  ${line}`);
  }

  const urls = DASHBOARD_LOAD_PATHS.map((path) => new URL(`${base}${path}`));
  for (let index = 0; index < options.warmup; index++) {
    const load = await dashboardLoad(urls, session.jar);
    result.warmupFailures.push(...load.failures);
  }
  log(
    `Warm-up: ${options.warmup} loads, ${result.warmupFailures.length} failed responses`,
  );
  for (let index = 0; index < options.loads; index++) {
    const load = await dashboardLoad(urls, session.jar);
    result.durationsMs.push(load.durationMs);
    result.failures.push(...load.failures);
  }

  const stats = loadStats(result.durationsMs);
  result.stats = stats;
  const rank = (percentile: number) =>
    `${Math.max(1, Math.ceil(percentile * stats.count))}th of ${stats.count}`;
  log(
    `Measured: ${stats.count} sequential loads (${stats.count * urls.length} responses)`,
  );
  log(`  min     ${ms(stats.minMs)}`);
  log(`  median  ${ms(stats.medianMs)}  (nearest rank, ${rank(0.5)})`);
  log(`  p95     ${ms(stats.p95Ms)}  (nearest rank, ${rank(0.95)})`);
  log(`  max     ${ms(stats.maxMs)}`);
  log(
    `  failed responses: ${result.failures.length} measured, ${result.warmupFailures.length} warm-up`,
  );
  for (const failure of [...result.warmupFailures, ...result.failures].slice(
    0,
    10,
  )) {
    log(`    ${failure}`);
  }

  if (result.failures.length || result.warmupFailures.length) {
    result.exitCode = 4;
    log('Result: FAIL (failed responses)');
  } else if (stats.p95Ms > P95_LIMIT_MS) {
    result.exitCode = 1;
    log(`Result: FAIL (p95 ${ms(stats.p95Ms)} > ${P95_LIMIT_MS} ms)`);
  } else {
    result.exitCode = 0;
    log(`Result: PASS (p95 ${ms(stats.p95Ms)} <= ${P95_LIMIT_MS} ms)`);
  }
  log(
    `RESULT ${JSON.stringify({
      seed: BENCH_SEED,
      anchor: fixture.anchor,
      month: fixture.expected.month,
      warmupLoads: options.warmup,
      loads: stats.count,
      minMs: round1(stats.minMs),
      medianMs: round1(stats.medianMs),
      p95Ms: round1(stats.p95Ms),
      maxMs: round1(stats.maxMs),
      failedResponses: result.failures.length + result.warmupFailures.length,
      totalsMatched: result.totalsMatched,
      exitCode: result.exitCode,
      host: hostDescription(base),
    })}`,
  );
  return result;
}

async function runCommand(args: string[]): Promise<number> {
  let options: BenchmarkOptions;
  try {
    const flags = parseFlags(args, [
      'base-url',
      'email',
      'anchor',
      'warmup',
      'loads',
    ]);
    const baseUrl = flags['base-url'];
    if (!baseUrl || !/^https?:$/.test(safeProtocol(baseUrl))) {
      throw new UsageError('--base-url must be an http(s) URL ending in /api.');
    }
    options = {
      baseUrl,
      email: flags.email ?? BENCH_EMAIL,
      password: benchPassword(),
      anchor: anchorFlag(flags.anchor),
      warmup: integerFlag(flags.warmup, 10, 'warmup', 0),
      loads: integerFlag(flags.loads, 200, 'loads', 1),
    };
  } catch (error) {
    console.error(`${describeError(error)}\n${USAGE}`);
    return 2;
  }
  const result = await runDashboardBenchmark(options);
  return result.exitCode;
}

const safeProtocol = (url: string) => {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
};

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'seed') {
    return seedCommand(rest, (line) => console.log(line));
  }
  if (command === 'run') {
    return runCommand(rest);
  }
  console.error(USAGE);
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(
        scrub(describeError(error), [
          process.env.BENCH_USER_PASSWORD,
          process.env.BENCH_DATABASE_URL,
        ]),
      );
      process.exit(1);
    },
  );
}
