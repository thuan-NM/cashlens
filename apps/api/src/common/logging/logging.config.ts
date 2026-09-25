import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import { stdSerializers } from 'pino';
import { correlationIdOf } from '../http/correlation';

/**
 * The API logger (OPS-008, ERR-006): structured, correlated, and redacted in
 * one place, so no call site has to remember what is sensitive.
 *
 * - Every request log line and every application log written while serving a
 *   request carries `correlationId`, the id returned to the client.
 * - Request lines keep the method, the route with its sensitive query values
 *   replaced (the Gmail callback's `code` and `state`), the peer address and
 *   port (the T100 TRUST_PROXY check reads `req.remoteAddress`), a few safe
 *   headers, and the response status. Cookies, authorization, and Set-Cookie
 *   are never serialized.
 * - Any logged object loses the values of sensitive keys (tokens, keys,
 *   passwords, OAuth values, raw email bodies, parser payloads, transaction
 *   descriptions, notification content), at the top level and one level
 *   down.
 * - Every string that is logged (messages, error messages and stacks, nested
 *   values) is scrubbed of connection-string passwords, bearer tokens, JWTs,
 *   Google tokens, and `secret=value` pairs.
 */

export const REDACTED = '[REDACTED]';

/** Keys whose values are never logged. */
export const SENSITIVE_KEYS = [
  // credentials and tokens
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'accessTokenEncrypted',
  'refreshTokenEncrypted',
  'authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'secret',
  'clientSecret',
  'jwtSecret',
  'tokenEncryptionKey',
  'encryptionKey',
  'smtpPassword',
  'SMTP_PASSWORD',
  'databaseUrl',
  'DATABASE_URL',
  // OAuth values
  'code',
  'authorizationCode',
  'state',
  'oauthState',
  'nonce',
  // email and parser content
  'body',
  'rawBody',
  'emailBody',
  'html',
  'text',
  'snippet',
  'subject',
  'payload',
  'extractedPayload',
  'normalizedPayload',
  'evidence',
  // financial free text
  'description',
  'normalizedDescription',
  'merchantName',
  'counterpartyName',
  'userNote',
] as const;

/** A key as compared for redaction: `Set-Cookie` and `set_cookie` match `setcookie`. */
const normalizeKey = (key: string) => key.toLowerCase().replace(/[-_]/g, '');

const SENSITIVE_KEY_SET = new Set<string>([
  ...SENSITIVE_KEYS.map(normalizeKey),
  // snake_case and header spellings of the same values
  'clientsecret',
  'apikey',
  'privatekey',
]);

/** Whether a logged key's value must never be written. */
export const isSensitiveKey = (key: string) =>
  SENSITIVE_KEY_SET.has(normalizeKey(key));

/**
 * fast-redact paths: each key at the top level and one level down. They are
 * the backstop; scrubValue below redacts sensitive keys at any depth.
 */
const REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => {
  const safe = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
  const nested = safe.startsWith('[') ? `*${safe}` : `*.${safe}`;
  return [safe, nested];
});

/**
 * Query parameters whose values never reach a log line: OAuth and credential
 * values, and free-text search (merchant and description text).
 */
const SENSITIVE_QUERY =
  /^(code|state|token|access_token|refresh_token|id_token|password|secret|client_secret|key|signature|nonce|search|q|query)$/i;

/** The URL with sensitive query values replaced; path and other params kept. */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const index = url.indexOf('?');
  if (index < 0) return url;
  const params = new URLSearchParams(url.slice(index + 1));
  let changed = false;
  for (const name of [...new Set(params.keys())]) {
    if (SENSITIVE_QUERY.test(name)) {
      params.set(name, REDACTED);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, index)}?${params.toString()}` : url;
}

const SECRET_NAMES =
  'password|passwd|secret|client_secret|smtp_password|api[_-]?key|access_token|refresh_token|id_token|token|code|state';

const SCRUBBERS: [RegExp, string][] = [
  // scheme://user:password@host and scheme://:password@host (bounded scheme:
  // no quadratic backtracking on long alphanumeric runs)
  [/(\b[a-z][a-z0-9+.-]{0,20}:\/\/[^:\s/@]*:)[^@\s]+@/gi, `$1${REDACTED}@`],
  // JSON-style "password":"x" and password: "x"
  [
    new RegExp(`("?\\b(?:${SECRET_NAMES})"?\\s*[:=]\\s*)"[^"]*"`, 'gi'),
    `$1"${REDACTED}"`,
  ],
  // URL-encoded password%3Dx
  [new RegExp(`(\\b(?:${SECRET_NAMES})%3D)[^&\\s%]+`, 'gi'), `$1${REDACTED}`],
  // Google authorization codes (4/0A...)
  [/\b4\/0[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/\bya29\.[\w.-]+/g, REDACTED],
  [/(^|[\s"'=:(])1\/\/[\w.-]+/g, `$1${REDACTED}`],
  // key=value and key: value pairs (form bodies, messages)
  [
    new RegExp(`\\b(${SECRET_NAMES})(\\s*[=:]\\s*)[^\\s,;&"']+`, 'gi'),
    `$1$2${REDACTED}`,
  ],
];

/** Removes credentials that can hide inside free text. */
export function scrubText(text: string): string {
  return SCRUBBERS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

const isPlain = (value: object) => {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null || Array.isArray(value);
};

/**
 * Scrubs every string in a logged value (depth-limited, cycle-safe). Only
 * plain objects and arrays are copied: requests, responses, and errors keep
 * their identity for their own serializers (the error serializer scrubs).
 */
function scrubValue(value: unknown, depth = 0, seen = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (!isPlain(value) || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // Sensitive keys are redacted at any depth, whatever their spelling.
    out[key] = isSensitiveKey(key)
      ? REDACTED
      : scrubValue(item, depth + 1, seen);
  }
  return out;
}

/** Headers safe and useful to keep (T100 diagnosis, proxy checks). */
const SAFE_HEADERS = [
  'host',
  'user-agent',
  'content-length',
  'content-type',
  'x-forwarded-proto',
  'x-forwarded-for',
] as const;

type SerializedRequest = {
  id?: unknown;
  method?: string;
  url?: string;
  remoteAddress?: string;
  remotePort?: number;
  headers?: Record<string, unknown>;
};

const serializeRequest = (req: SerializedRequest) => {
  const headers: Record<string, unknown> = {};
  for (const name of SAFE_HEADERS) {
    if (req.headers?.[name] !== undefined) headers[name] = req.headers[name];
  }
  return {
    id: req.id,
    method: req.method,
    url: sanitizeUrl(req.url),
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
    headers,
  };
};

const serializeError = (err: Error) => {
  // pino-http hands a wrapped error whose `raw` is the original.
  const raw = (err as { raw?: unknown }).raw;
  const source = raw instanceof Error ? raw : err;
  // stdSerializers.err returns a non-plain object; copy its fields first.
  const serialized = {
    ...(stdSerializers.err(source) as unknown as Record<string, unknown>),
  };
  return scrubValue(serialized) as Record<string, unknown>;
};

export function buildPinoHttpOptions(
  env: { nodeEnv?: string; logLevel?: string } = {
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
  },
  pretty = true,
): Options {
  const isProduction = env.nodeEnv === 'production';
  return {
    // The request log id is the correlation id returned to the client.
    genReqId: (req: IncomingMessage) => correlationIdOf(req),
    level: env.logLevel ?? (isProduction ? 'info' : 'debug'),
    transport:
      isProduction || !pretty
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
            },
          },
    customProps: (req: IncomingMessage) => ({
      correlationId: correlationIdOf(req),
    }),
    serializers: {
      req: serializeRequest,
      res: (res: ServerResponse & { statusCode: number }) => ({
        statusCode: res.statusCode,
      }),
      err: serializeError,
    },
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    hooks: {
      // Message strings and extra arguments are scrubbed before formatting.
      logMethod(args: unknown[], method: (...args: unknown[]) => void) {
        let scrubbed: unknown[];
        try {
          scrubbed = args.map((arg) => scrubValue(arg));
        } catch {
          // An object whose getters throw: log that fact, never its content.
          scrubbed = [{ event: 'log.unserializable' }];
        }
        method.apply(this, scrubbed);
      },
    },
  };
}
