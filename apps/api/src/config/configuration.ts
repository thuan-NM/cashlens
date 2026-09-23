import { isIP } from 'node:net';
import { isPlaceholderSecret } from './placeholder-secrets';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type EmailTransportKind = 'disabled' | 'smtp' | 'log';
export type CookieSameSite = 'lax' | 'strict';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  isProduction: boolean;
  port: number;
  logLevel?: string;
  databaseUrl?: string;
  jwt: {
    secret: string;
    expiresIn?: string;
    refreshExpiresInDays: number;
  };
  corsOrigins: string[];
  trustProxy: string[];
  cookies: {
    secure: boolean;
    sameSite: CookieSameSite;
  };
  tokenEncryptionKey?: string;
  gmail: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    oauthStateSecret?: string;
  };
  email: {
    transport: EmailTransportKind;
    attemptTimeoutMs: number;
    totalBudgetMs: number;
    from?: string;
    appPublicUrl?: string;
    smtp?: SmtpConfig;
  };
}

export interface ConfigIssue {
  key: string;
  reason: string;
}

/**
 * Raised before the application binds a port. The message lists variable
 * names and reasons only; configured values are never echoed.
 */
export class ConfigValidationError extends Error {
  constructor(
    readonly nodeEnv: string,
    readonly issues: ConfigIssue[],
  ) {
    super(
      [
        `Invalid environment configuration (${nodeEnv}):`,
        ...issues.map((issue) => `  - ${issue.key}: ${issue.reason}`),
      ].join('\n'),
    );
    this.name = 'ConfigValidationError';
  }
}

const NODE_ENVIRONMENTS: readonly NodeEnvironment[] = [
  'development',
  'test',
  'production',
];
const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
const EMAIL_TRANSPORTS: readonly EmailTransportKind[] = [
  'disabled',
  'smtp',
  'log',
];
const COOKIE_SAME_SITE_VALUES: readonly CookieSameSite[] = ['lax', 'strict'];
const TRUST_PROXY_KEYWORDS = ['loopback', 'linklocal', 'uniquelocal'];
const SECRET_MIN_LENGTH = 32;
const DEVELOPMENT_CORS_ORIGIN = 'http://localhost:5173';
const DEVELOPMENT_TRUST_PROXY = 'loopback';

type RawEnv = Record<string, unknown>;

class EnvReader {
  readonly issues: ConfigIssue[] = [];

  constructor(
    private readonly env: RawEnv,
    readonly production: boolean,
  ) {}

  issue(key: string, reason: string) {
    this.issues.push({ key, reason });
  }

  /** Trimmed value, or undefined when unset or blank. */
  value(key: string): string | undefined {
    const raw = this.env[key];
    let text: string;
    if (typeof raw === 'string') {
      text = raw.trim();
    } else if (typeof raw === 'number' || typeof raw === 'boolean') {
      text = String(raw);
    } else {
      return undefined;
    }
    return text === '' ? undefined : text;
  }

  isBlank(key: string): boolean {
    const raw = this.env[key];
    return typeof raw === 'string' && raw.trim() === '';
  }

  required(key: string, when: boolean): string | undefined {
    const value = this.value(key);
    if (value === undefined && when) {
      this.issue(
        key,
        this.isBlank(key) ? 'must not be empty' : 'is required but missing',
      );
    }
    return value;
  }

  secret(
    key: string,
    options: { required: boolean; minLength?: number; strict: boolean },
  ): string | undefined {
    const value = this.required(key, options.required);
    if (value === undefined) {
      return undefined;
    }
    if (options.strict && isPlaceholderSecret(value)) {
      this.issue(key, 'must not be a known placeholder value');
      return value;
    }
    if (options.minLength && value.length < options.minLength) {
      this.issue(key, `must contain at least ${options.minLength} characters`);
    }
    return value;
  }

  oneOf<T extends string>(
    key: string,
    allowed: readonly T[],
    fallback?: T,
  ): T | undefined {
    const value = this.value(key);
    if (value === undefined) {
      return fallback;
    }
    if (!(allowed as readonly string[]).includes(value)) {
      this.issue(key, `must be one of: ${allowed.join(', ')}`);
      return fallback;
    }
    return value as T;
  }

  integer(
    key: string,
    options: {
      min: number;
      max: number;
      fallback?: number;
      required?: boolean;
    },
  ): number | undefined {
    const value = this.required(key, options.required ?? false);
    if (value === undefined) {
      return options.fallback;
    }
    if (!/^\d+$/.test(value)) {
      this.issue(key, 'must be a whole number');
      return options.fallback;
    }
    const parsed = Number(value);
    if (parsed < options.min || parsed > options.max) {
      this.issue(key, `must be between ${options.min} and ${options.max}`);
      return options.fallback;
    }
    return parsed;
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.value(key);
    if (value === undefined) {
      return fallback;
    }
    const normalized = value.toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    this.issue(key, 'must be true or false');
    return fallback;
  }

  httpUrl(
    key: string,
    options: { required: boolean; originOnly?: boolean },
  ): string | undefined {
    const value = this.required(key, options.required);
    if (value === undefined) {
      return undefined;
    }
    const parsed = parseHttpUrl(value);
    if (!parsed) {
      this.issue(key, 'must be an absolute http(s) URL');
      return undefined;
    }
    if (options.originOnly && !isBareOrigin(parsed)) {
      this.issue(key, 'must be an origin without a path, query, or fragment');
      return undefined;
    }
    if (this.production && parsed.protocol !== 'https:') {
      this.issue(key, 'must use https in production');
    }
    return options.originOnly ? parsed.origin : value;
  }
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function isBareOrigin(url: URL): boolean {
  return url.pathname === '/' && url.search === '' && url.hash === '';
}

function isValidTrustProxyToken(token: string): boolean {
  if (TRUST_PROXY_KEYWORDS.includes(token)) {
    return true;
  }
  const [address, prefix, ...rest] = token.split('/');
  if (rest.length > 0) {
    return false;
  }
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^\d+$/.test(prefix)) {
    return false;
  }
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function readDatabaseUrl(reader: EnvReader): string | undefined {
  const value = reader.required('DATABASE_URL', reader.production);
  if (value === undefined) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    reader.issue('DATABASE_URL', 'must be a postgresql:// connection URL');
    return undefined;
  }
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    !url.hostname
  ) {
    reader.issue('DATABASE_URL', 'must be a postgresql:// connection URL');
    return undefined;
  }
  // pg also takes the password from a `?password=` query parameter.
  const passwords = [
    url.password ? safeDecode(url.password) : '',
    url.searchParams.get('password') ?? '',
  ];
  if (reader.production && passwords.some((p) => p && isPlaceholderSecret(p))) {
    reader.issue(
      'DATABASE_URL',
      'must not use a known placeholder database password',
    );
  }
  return value;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readCorsOrigins(reader: EnvReader): string[] {
  const value = reader.required('CORS_ORIGIN', reader.production);
  if (value === undefined) {
    return reader.production ? [] : [DEVELOPMENT_CORS_ORIGIN];
  }
  const origins: string[] = [];
  for (const entry of value.split(',').map((part) => part.trim())) {
    const parsed = entry ? parseHttpUrl(entry) : undefined;
    if (!parsed || !isBareOrigin(parsed)) {
      reader.issue(
        'CORS_ORIGIN',
        'must be a comma-separated list of http(s) origins without paths',
      );
      return origins;
    }
    if (reader.production && parsed.protocol !== 'https:') {
      reader.issue('CORS_ORIGIN', 'must use https origins in production');
      return origins;
    }
    origins.push(parsed.origin);
  }
  return origins;
}

function readTrustProxy(reader: EnvReader): string[] {
  const value =
    reader.required('TRUST_PROXY', reader.production) ??
    (reader.production ? undefined : DEVELOPMENT_TRUST_PROXY);
  if (value === undefined) {
    return [];
  }
  const tokens = value.split(',').map((part) => part.trim());
  if (tokens.some((token) => !isValidTrustProxyToken(token))) {
    reader.issue(
      'TRUST_PROXY',
      'must be a comma-separated list of loopback, linklocal, uniquelocal, IP addresses, or CIDR ranges',
    );
    return [];
  }
  return tokens;
}

function readEmail(reader: EnvReader): AppConfig['email'] {
  const transport =
    reader.oneOf('EMAIL_TRANSPORT', EMAIL_TRANSPORTS, 'disabled') ?? 'disabled';
  if (reader.production && transport === 'log') {
    reader.issue(
      'EMAIL_TRANSPORT',
      'the redacted log transport is not allowed in production',
    );
  }

  const attemptTimeoutMs =
    reader.integer('EMAIL_ATTEMPT_TIMEOUT_MS', {
      min: 100,
      max: 60_000,
      fallback: 5_000,
    }) ?? 5_000;
  const totalBudgetMs =
    reader.integer('EMAIL_TOTAL_BUDGET_MS', {
      min: 100,
      max: 120_000,
      fallback: 12_000,
    }) ?? 12_000;
  if (totalBudgetMs < attemptTimeoutMs) {
    reader.issue(
      'EMAIL_TOTAL_BUDGET_MS',
      'must be greater than or equal to EMAIL_ATTEMPT_TIMEOUT_MS',
    );
  }

  const usesSmtp = transport === 'smtp';
  const appPublicUrl = reader.httpUrl('APP_PUBLIC_URL', {
    required: usesSmtp,
  });
  const from = reader.required('EMAIL_FROM', usesSmtp);
  if (
    from !== undefined &&
    !/^(?:[^<>]*<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(from)
  ) {
    reader.issue('EMAIL_FROM', 'must be an email address');
  }

  let smtp: SmtpConfig | undefined;
  if (usesSmtp) {
    const host = reader.required('SMTP_HOST', true);
    const port = reader.integer('SMTP_PORT', {
      min: 1,
      max: 65_535,
      required: true,
    });
    const secure = reader.boolean('SMTP_SECURE', false);
    const user = reader.required('SMTP_USER', true);
    const password = reader.secret('SMTP_PASSWORD', {
      required: true,
      strict: reader.production,
    });
    if (host && port && user && password) {
      smtp = { host, port, secure, user, password };
    }
  }

  return {
    transport,
    attemptTimeoutMs,
    totalBudgetMs,
    from,
    appPublicUrl,
    smtp,
  };
}

/**
 * Parses and validates the process environment into a typed configuration.
 * Unknown `NODE_ENV` values are validated with production rules (fail safe).
 */
export function parseEnvironment(env: RawEnv): AppConfig {
  const rawNodeEnv =
    typeof env.NODE_ENV === 'string' && env.NODE_ENV.trim() !== ''
      ? env.NODE_ENV.trim()
      : 'development';
  const knownNodeEnv = (NODE_ENVIRONMENTS as readonly string[]).includes(
    rawNodeEnv,
  );
  const nodeEnv = (knownNodeEnv ? rawNodeEnv : 'production') as NodeEnvironment;
  const production = nodeEnv === 'production';
  const reader = new EnvReader(env, production);
  if (!knownNodeEnv) {
    reader.issue('NODE_ENV', `must be one of: ${NODE_ENVIRONMENTS.join(', ')}`);
  }

  const port =
    reader.integer('PORT', { min: 1, max: 65_535, fallback: 3000 }) ?? 3000;
  const logLevel = reader.oneOf('LOG_LEVEL', LOG_LEVELS);
  const databaseUrl = readDatabaseUrl(reader);

  const jwtSecret = reader.secret('JWT_SECRET', {
    required: true,
    minLength: production ? SECRET_MIN_LENGTH : undefined,
    strict: production,
  });
  const jwtExpiresIn = reader.value('JWT_EXPIRES_IN');
  // A unit is required: jsonwebtoken reads a bare number string as milliseconds.
  if (
    jwtExpiresIn !== undefined &&
    !/^[1-9]\d*(s|m|h|d|w|y)$/.test(jwtExpiresIn)
  ) {
    reader.issue('JWT_EXPIRES_IN', 'must be a duration such as 15m, 1h, or 7d');
  }
  const refreshExpiresInDays =
    reader.integer('JWT_REFRESH_EXPIRES_IN_DAYS', {
      min: 1,
      max: 365,
      fallback: 30,
    }) ?? 30;

  const corsOrigins = readCorsOrigins(reader);
  const trustProxy = readTrustProxy(reader);

  const cookieSecure = reader.boolean('COOKIE_SECURE', production);
  if (production && !cookieSecure) {
    reader.issue('COOKIE_SECURE', 'must not be disabled in production');
  }
  const cookieSameSite =
    reader.oneOf('COOKIE_SAME_SITE', COOKIE_SAME_SITE_VALUES, 'lax') ?? 'lax';

  const tokenEncryptionKey = reader.secret('EMAIL_TOKEN_ENCRYPTION_KEY', {
    required: production,
    minLength: SECRET_MIN_LENGTH,
    strict: production,
  });

  const gmail = {
    clientId: reader.secret('GMAIL_CLIENT_ID', {
      required: production,
      strict: production,
    }),
    clientSecret: reader.secret('GMAIL_CLIENT_SECRET', {
      required: production,
      strict: production,
    }),
    redirectUri: reader.httpUrl('GMAIL_REDIRECT_URI', {
      required: production,
    }),
    oauthStateSecret: reader.secret('GMAIL_OAUTH_STATE_SECRET', {
      required: production,
      minLength: production ? SECRET_MIN_LENGTH : undefined,
      strict: production,
    }),
  };

  const email = readEmail(reader);

  if (reader.issues.length > 0) {
    throw new ConfigValidationError(rawNodeEnv, reader.issues);
  }

  return {
    nodeEnv,
    isProduction: production,
    port,
    logLevel,
    databaseUrl,
    jwt: {
      secret: jwtSecret as string,
      expiresIn: jwtExpiresIn,
      refreshExpiresInDays,
    },
    corsOrigins,
    trustProxy,
    cookies: { secure: cookieSecure, sameSite: cookieSameSite },
    tokenEncryptionKey,
    gmail,
    email,
  };
}

/**
 * `ConfigModule.forRoot({ validate })` hook. Runs before any provider is
 * created, so invalid configuration stops startup before a port is bound.
 * Returns string values so existing `ConfigService.get<string>()` callers
 * keep working, with defaults filled in.
 */
export function validateEnvironment(env: RawEnv): Record<string, unknown> {
  const config = parseEnvironment(env);

  return {
    ...env,
    NODE_ENV: config.nodeEnv,
    PORT: String(config.port),
    CORS_ORIGIN: config.corsOrigins.join(','),
    TRUST_PROXY: config.trustProxy.join(','),
    COOKIE_SECURE: String(config.cookies.secure),
    COOKIE_SAME_SITE: config.cookies.sameSite,
    JWT_REFRESH_EXPIRES_IN_DAYS: String(config.jwt.refreshExpiresInDays),
    EMAIL_TRANSPORT: config.email.transport,
    EMAIL_ATTEMPT_TIMEOUT_MS: String(config.email.attemptTimeoutMs),
    EMAIL_TOTAL_BUDGET_MS: String(config.email.totalBudgetMs),
  };
}
