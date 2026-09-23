import {
  ConfigValidationError,
  parseEnvironment,
  validateEnvironment,
} from './configuration';
import {
  PLACEHOLDER_SECRETS,
  isPlaceholderSecret,
} from './placeholder-secrets';

type Env = Record<string, string | undefined>;

// Synthetic, obviously fake values. None of them is a real credential.
const productionEnv = (overrides: Env = {}): Env => ({
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://cashlens:SyntheticDbPassword-0123456789@postgres:5432/cashlens_db?schema=public',
  JWT_SECRET: 'synthetic-jwt-secret-0123456789-abcdefghijklmnop',
  EMAIL_TOKEN_ENCRYPTION_KEY: 'synthetic-encryption-key-0123456789-abcdefgh',
  GMAIL_CLIENT_ID: 'synthetic-client-id.apps.googleusercontent.test',
  GMAIL_CLIENT_SECRET: 'synthetic-gmail-client-secret-0123456789',
  GMAIL_REDIRECT_URI:
    'https://cashlens.example.test/api/email-connections/gmail/callback',
  GMAIL_OAUTH_STATE_SECRET: 'synthetic-oauth-state-secret-0123456789-abcdef',
  CORS_ORIGIN: 'https://cashlens.example.test',
  TRUST_PROXY: 'loopback,172.28.0.1',
  ...overrides,
});

const developmentEnv = (overrides: Env = {}): Env => ({
  NODE_ENV: 'development',
  JWT_SECRET: 'change-me',
  ...overrides,
});

const smtpSettings = (overrides: Env = {}): Env => ({
  EMAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_USER: 'synthetic-smtp-user',
  SMTP_PASSWORD: 'synthetic-smtp-password-0123456789',
  EMAIL_FROM: 'alerts@example.test',
  APP_PUBLIC_URL: 'https://cashlens.example.test',
  ...overrides,
});

const issueKeys = (env: Env): string[] => {
  try {
    parseEnvironment(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error.issues.map((issue) => issue.key);
    }
    throw error;
  }
  return [];
};

describe('startup configuration', () => {
  describe('development mode', () => {
    it('accepts a minimal development environment and applies defaults', () => {
      const config = parseEnvironment(developmentEnv());

      expect(config.nodeEnv).toBe('development');
      expect(config.isProduction).toBe(false);
      expect(config.port).toBe(3000);
      expect(config.corsOrigins).toEqual(['http://localhost:5173']);
      expect(config.trustProxy).toEqual(['loopback']);
      expect(config.cookies).toEqual({ secure: false, sameSite: 'lax' });
      expect(config.email.transport).toBe('disabled');
      expect(config.jwt.refreshExpiresInDays).toBe(30);
    });

    it('allows documented development placeholders outside production', () => {
      expect(
        issueKeys(
          developmentEnv({
            JWT_SECRET: 'change-me',
            DATABASE_URL:
              'postgresql://cashlens:cashlens_password@localhost:5432/cashlens_db',
            EMAIL_TOKEN_ENCRYPTION_KEY:
              'replace-with-at-least-32-random-characters',
          }),
        ),
      ).toEqual([]);
    });

    it('treats the test environment like development', () => {
      const config = parseEnvironment(developmentEnv({ NODE_ENV: 'test' }));
      expect(config.nodeEnv).toBe('test');
      expect(config.isProduction).toBe(false);
    });

    it('still requires a JWT secret', () => {
      expect(issueKeys(developmentEnv({ JWT_SECRET: undefined }))).toContain(
        'JWT_SECRET',
      );
    });

    it('rejects a too-short encryption key in every mode (CFG-005)', () => {
      expect(
        issueKeys(developmentEnv({ EMAIL_TOKEN_ENCRYPTION_KEY: 'too-short' })),
      ).toContain('EMAIL_TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('production mode', () => {
    it('accepts a complete production environment', () => {
      const config = parseEnvironment(productionEnv());

      expect(config.isProduction).toBe(true);
      expect(config.cookies).toEqual({ secure: true, sameSite: 'lax' });
      expect(config.trustProxy).toEqual(['loopback', '172.28.0.1']);
      expect(config.corsOrigins).toEqual(['https://cashlens.example.test']);
      expect(config.email.transport).toBe('disabled');
    });

    it.each([
      'DATABASE_URL',
      'JWT_SECRET',
      'EMAIL_TOKEN_ENCRYPTION_KEY',
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REDIRECT_URI',
      'GMAIL_OAUTH_STATE_SECRET',
      'CORS_ORIGIN',
      'TRUST_PROXY',
    ])('rejects a missing %s', (key) => {
      expect(issueKeys(productionEnv({ [key]: undefined }))).toContain(key);
    });

    it.each(['JWT_SECRET', 'GMAIL_CLIENT_SECRET', 'CORS_ORIGIN'])(
      'rejects an empty or whitespace-only %s',
      (key) => {
        expect(issueKeys(productionEnv({ [key]: '' }))).toContain(key);
        expect(issueKeys(productionEnv({ [key]: '   ' }))).toContain(key);
      },
    );

    it.each([
      ['JWT_SECRET', 'change-me'],
      ['JWT_SECRET', 'replace-with-a-random-jwt-secret-value-for-prod'],
      [
        'EMAIL_TOKEN_ENCRYPTION_KEY',
        'replace-with-at-least-32-random-characters',
      ],
      ['GMAIL_OAUTH_STATE_SECRET', 'replace-with-a-random-oauth-state-secret'],
      ['GMAIL_CLIENT_SECRET', 'replace-with-google-oauth-client-secret'],
      ['GMAIL_CLIENT_ID', 'replace-with-google-oauth-client-id'],
    ])('rejects the known placeholder for %s', (key, placeholder) => {
      expect(issueKeys(productionEnv({ [key]: placeholder }))).toContain(key);
    });

    it('rejects a database URL whose password is a known placeholder', () => {
      expect(
        issueKeys(
          productionEnv({
            DATABASE_URL:
              'postgresql://cashlens:cashlens_password@postgres:5432/cashlens_db',
          }),
        ),
      ).toContain('DATABASE_URL');
    });

    it('rejects a placeholder database password given as a query parameter', () => {
      // pg reads ?password= as the connection password.
      expect(
        issueKeys(
          productionEnv({
            DATABASE_URL:
              'postgresql://cashlens@postgres:5432/cashlens_db?password=cashlens_password',
          }),
        ),
      ).toContain('DATABASE_URL');
    });

    it.each(['JWT_SECRET', 'GMAIL_OAUTH_STATE_SECRET'])(
      'requires at least 32 characters for %s',
      (key) => {
        expect(
          issueKeys(productionEnv({ [key]: 'short-but-not-a-placeholder' })),
        ).toContain(key);
      },
    );

    it.each([
      ['CORS_ORIGIN', 'http://cashlens.example.test'],
      [
        'GMAIL_REDIRECT_URI',
        'http://cashlens.example.test/api/email-connections/gmail/callback',
      ],
      ['APP_PUBLIC_URL', 'http://cashlens.example.test'],
    ])('requires https for %s (OPS-009)', (key, value) => {
      expect(issueKeys(productionEnv({ [key]: value }))).toContain(key);
    });

    it('rejects disabling secure cookies', () => {
      expect(issueKeys(productionEnv({ COOKIE_SECURE: 'false' }))).toContain(
        'COOKIE_SECURE',
      );
    });
  });

  describe('malformed values', () => {
    it.each([
      ['NODE_ENV', 'staging'],
      ['PORT', 'abc'],
      ['PORT', '70000'],
      ['LOG_LEVEL', 'loud'],
      ['DATABASE_URL', 'mysql://user:pass@host:3306/db'],
      ['DATABASE_URL', 'not a url'],
      ['JWT_EXPIRES_IN', 'forever'],
      // jsonwebtoken reads a unit-less string as milliseconds.
      ['JWT_EXPIRES_IN', '900'],
      ['JWT_EXPIRES_IN', '15ms'],
      ['JWT_EXPIRES_IN', '0m'],
      ['JWT_REFRESH_EXPIRES_IN_DAYS', '0'],
      ['JWT_REFRESH_EXPIRES_IN_DAYS', 'thirty'],
      ['CORS_ORIGIN', 'not-a-url'],
      ['CORS_ORIGIN', 'https://cashlens.example.test/with-a-path'],
      ['GMAIL_REDIRECT_URI', 'not-a-url'],
      ['COOKIE_SECURE', 'maybe'],
      ['COOKIE_SAME_SITE', 'none'],
    ])('rejects %s=%s', (key, value) => {
      expect(issueKeys(productionEnv({ [key]: value }))).toContain(key);
    });

    it.each(['15m', '1h', '7d', '3600s'])(
      'accepts JWT_EXPIRES_IN=%s',
      (value) => {
        expect(
          issueKeys(productionEnv({ JWT_EXPIRES_IN: value })),
        ).not.toContain('JWT_EXPIRES_IN');
      },
    );
  });

  describe('trusted proxy hops', () => {
    it.each([
      'loopback',
      '172.28.0.1',
      'loopback,172.28.0.1',
      '10.0.0.0/8',
      '::1',
      'fd00::/8',
      'loopback, uniquelocal',
    ])('accepts TRUST_PROXY=%s', (value) => {
      expect(issueKeys(productionEnv({ TRUST_PROXY: value }))).toEqual([]);
    });

    it.each(['everyone', 'true', '300.1.1.1', '10.0.0.0/99', 'loopback,,'])(
      'rejects TRUST_PROXY=%s',
      (value) => {
        expect(issueKeys(productionEnv({ TRUST_PROXY: value }))).toContain(
          'TRUST_PROXY',
        );
        expect(issueKeys(developmentEnv({ TRUST_PROXY: value }))).toContain(
          'TRUST_PROXY',
        );
      },
    );
  });

  describe('email transport (CFG-007)', () => {
    it('accepts disabled delivery in every mode', () => {
      expect(issueKeys(productionEnv({ EMAIL_TRANSPORT: 'disabled' }))).toEqual(
        [],
      );
      expect(
        issueKeys(developmentEnv({ EMAIL_TRANSPORT: 'disabled' })),
      ).toEqual([]);
    });

    it('accepts a complete SMTP configuration in production', () => {
      const config = parseEnvironment(productionEnv(smtpSettings()));
      expect(config.email.transport).toBe('smtp');
      expect(config.email.smtp).toMatchObject({
        host: 'smtp.example.test',
        port: 587,
        secure: false,
      });
      expect(config.email.attemptTimeoutMs).toBe(5000);
      expect(config.email.totalBudgetMs).toBe(12000);
    });

    it.each([
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'EMAIL_FROM',
      'APP_PUBLIC_URL',
    ])('requires %s when EMAIL_TRANSPORT=smtp', (key) => {
      expect(
        issueKeys(productionEnv(smtpSettings({ [key]: undefined }))),
      ).toContain(key);
    });

    it('rejects a placeholder SMTP password in production', () => {
      expect(
        issueKeys(
          productionEnv(
            smtpSettings({ SMTP_PASSWORD: 'replace-with-smtp-password' }),
          ),
        ),
      ).toContain('SMTP_PASSWORD');
    });

    it('rejects malformed SMTP values', () => {
      expect(
        issueKeys(productionEnv(smtpSettings({ SMTP_PORT: 'twenty-five' }))),
      ).toContain('SMTP_PORT');
      expect(
        issueKeys(
          productionEnv(smtpSettings({ EMAIL_FROM: 'not-an-address' })),
        ),
      ).toContain('EMAIL_FROM');
    });

    it('allows the redacted log transport only outside production', () => {
      expect(issueKeys(developmentEnv({ EMAIL_TRANSPORT: 'log' }))).toEqual([]);
      expect(issueKeys(productionEnv({ EMAIL_TRANSPORT: 'log' }))).toContain(
        'EMAIL_TRANSPORT',
      );
    });

    it('rejects an unknown transport', () => {
      expect(
        issueKeys(developmentEnv({ EMAIL_TRANSPORT: 'carrier-pigeon' })),
      ).toContain('EMAIL_TRANSPORT');
    });

    it('rejects a total delivery budget below the attempt timeout', () => {
      expect(
        issueKeys(
          productionEnv({
            EMAIL_ATTEMPT_TIMEOUT_MS: '5000',
            EMAIL_TOTAL_BUDGET_MS: '1000',
          }),
        ),
      ).toContain('EMAIL_TOTAL_BUDGET_MS');
    });
  });

  describe('non-secret error reporting', () => {
    it('aggregates every problem and never echoes a configured value', () => {
      const leakySecret = 'leak-canary-9f3a';
      const leakyUrl = 'postgresql://cashlens:cashlens_password@db:5432/x';
      let caught: unknown;
      try {
        parseEnvironment(
          productionEnv({
            JWT_SECRET: leakySecret,
            DATABASE_URL: leakyUrl,
            CORS_ORIGIN: undefined,
          }),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigValidationError);
      const error = caught as ConfigValidationError;
      expect(error.issues.map((issue) => issue.key)).toEqual(
        expect.arrayContaining(['JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGIN']),
      );
      expect(error.message).toContain('production');
      expect(error.message).not.toContain(leakySecret);
      expect(error.message).not.toContain('cashlens_password');
      expect(error.message).not.toContain(leakyUrl);
    });
  });

  describe('ConfigModule validate hook', () => {
    it('returns string-typed values with defaults for existing consumers', () => {
      const validated = validateEnvironment(developmentEnv());

      expect(validated.JWT_SECRET).toBe('change-me');
      expect(validated.PORT).toBe('3000');
      expect(validated.TRUST_PROXY).toBe('loopback');
      expect(validated.EMAIL_TRANSPORT).toBe('disabled');
      expect(validated.CORS_ORIGIN).toBe('http://localhost:5173');
    });

    it('throws before the application can start on invalid production config', () => {
      expect(() =>
        validateEnvironment(productionEnv({ JWT_SECRET: undefined })),
      ).toThrow(ConfigValidationError);
    });
  });
});

describe('placeholder secrets', () => {
  it('recognizes every documented placeholder', () => {
    for (const placeholder of PLACEHOLDER_SECRETS) {
      expect(isPlaceholderSecret(placeholder)).toBe(true);
      expect(isPlaceholderSecret(placeholder.toUpperCase())).toBe(true);
    }
  });

  it('recognizes placeholder shapes', () => {
    expect(isPlaceholderSecret('replace-with-anything-here')).toBe(true);
    expect(isPlaceholderSecret('<your-secret>')).toBe(true);
  });

  it('does not flag synthetic random values', () => {
    expect(isPlaceholderSecret('q7Xk2mVb9LzR4tWc8NpE1sYh6FgD3aJu')).toBe(false);
  });
});
