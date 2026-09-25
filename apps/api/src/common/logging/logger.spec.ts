import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import pinoHttp from 'pino-http';
import { buildPinoHttpOptions, scrubText } from './logging.config';

/**
 * T094 (OPS-008, EMAIL-002, ALERT-007, ERR-006): what the API logger writes.
 * Every secret below is synthetic; the tests log through the production
 * options into memory and search the written lines. Nothing here asks
 * production code to log a secret.
 */

/**
 * Joins synthetic secret parts at runtime, so no source line is a secret-shaped
 * literal that the release secret scan (T009) would flag.
 */
const synthetic = (...parts: string[]) => parts.join('');

const SECRETS = {
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0OTQifQ.SYNTHjwtSIGNATURE0000000',
  refresh: 'SYNTH-refresh-token-0f9e8d7c6b5a',
  bearer: 'SYNTH-bearer-token-1a2b3c4d',
  setCookie: 'SYNTH-set-cookie-value-9z8y7x',
  oauthCode: '4/SYNTH-oauth-code-0AX4XfWh',
  oauthState: 'SYNTH-oauth-state-v1.abcdef.123456',
  googleAccess: 'ya29.SYNTH-google-access-token',
  googleRefresh: '1//SYNTH-google-refresh-token',
  encryptionKey: synthetic('SYNTH-encryption', '-key-at-least-32-characters'),
  smtpPassword: 'SYNTH-smtp-password-7h6g5f',
  dbPassword: synthetic('SYNTHdb', 'Passw0rd'),
  rawBody: 'SYNTH raw email body: So tien -5,000,000 VND tai CIRCLE K',
  parserPayload: 'SYNTH parser payload amount=5000000',
  description: 'SYNTH Thanh toan QR tai CIRCLE K so the 1234',
  notification: 'SYNTH notification: you spent 5,000,000 VND',
  password: 'SYNTH-user-password-Aa1!',
  subject: 'SYNTH Bien dong so du +1,000,000 VND',
};

/** Identifiers that must stay searchable. */
const IDS = {
  correlationId: '0b7e6c1a-2d3f-4a5b-8c9d-0e1f2a3b4c5d',
  userId: 'cuid-user-t094',
  emailConnectionId: 'cuid-connection-t094',
  syncRunId: 'cuid-run-t094',
  parserRunId: 'cuid-parser-run-t094',
  categoryEventId: 'cuid-category-event-t094',
  ruleId: 'cuid-rule-t094',
  alertId: 'cuid-alert-t094',
  deliveryId: 'cuid-delivery-t094',
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const production = () =>
  buildPinoHttpOptions({ nodeEnv: 'production', logLevel: 'debug' }, false);

/** A pino-http instance on the production options, writing into memory. */
const capture = () => {
  const lines: string[] = [];
  const stream = { write: (line: string) => void lines.push(line) };
  const http = pinoHttp(production(), stream);
  const records = () =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const text = () => lines.join('\n');
  return { http, logger: http.logger, records, text };
};

/** Fails on the first secret found, raw or URL-encoded. */
const expectNoSecret = (text: string) => {
  for (const [name, value] of Object.entries(SECRETS)) {
    const leaked =
      text.includes(value) || text.includes(encodeURIComponent(value));
    expect({ name, leaked }).toEqual({ name, leaked: false });
  }
};

describe('request logs (T094)', () => {
  const serve = async (
    http: ReturnType<typeof pinoHttp>,
    path: string,
    headers: Record<string, string>,
  ) => {
    const server = createServer((req, res) => {
      http(req, res);
      res.setHeader('Set-Cookie', [
        `accessToken=${SECRETS.setCookie}; HttpOnly`,
        `refreshToken=${SECRETS.setCookie}; HttpOnly`,
      ]);
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path, headers },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  it('never writes cookies, authorization, set-cookie, or the OAuth callback code and state', async () => {
    const { http, text, records } = capture();
    await serve(
      http,
      `/api/email-connections/gmail/callback?code=${encodeURIComponent(SECRETS.oauthCode)}&state=${encodeURIComponent(SECRETS.oauthState)}&scope=gmail.readonly`,
      {
        cookie: `accessToken=${SECRETS.jwt}; refreshToken=${SECRETS.refresh}; gmailOAuthNonce=${SECRETS.oauthState}`,
        authorization: `Bearer ${SECRETS.bearer}`,
        'x-forwarded-proto': 'https',
      },
    );
    expectNoSecret(text());
    const [line] = records();
    const req = line.req as Record<string, unknown>;
    // The route stays searchable; only the sensitive query values go.
    expect(String(req.url)).toContain('/api/email-connections/gmail/callback');
    expect(String(req.url)).toContain('scope=gmail.readonly');
  });

  it('keeps the correlation id and the peer address (T100 TRUST_PROXY check)', async () => {
    const { http, records } = capture();
    await serve(http, '/api/health/ready', {});
    const [line] = records();
    const req = line.req as Record<string, unknown>;
    expect(line.correlationId).toMatch(UUID);
    expect(req.id).toBe(line.correlationId);
    expect(req.remoteAddress).toBe('127.0.0.1');
    expect(line.res).toMatchObject({ statusCode: 200 });
  });

  it('writes structured JSON in production, with no pretty transport', () => {
    expect(production().transport).toBeUndefined();
  });
});

describe('application event logs (T094)', () => {
  const event = (logger: ReturnType<typeof capture>['logger']) =>
    logger.info(
      {
        event: 'email.sync.finished',
        ...IDS,
        status: 'PARTIAL_FAILED',
        errorCode: 'PROVIDER',
        // Everything below must be redacted wherever it appears.
        accessToken: SECRETS.googleAccess,
        refreshToken: SECRETS.googleRefresh,
        token: SECRETS.jwt,
        password: SECRETS.password,
        authorizationCode: SECRETS.oauthCode,
        oauthState: SECRETS.oauthState,
        tokenEncryptionKey: SECRETS.encryptionKey,
        smtpPassword: SECRETS.smtpPassword,
        rawBody: SECRETS.rawBody,
        body: SECRETS.rawBody,
        payload: SECRETS.parserPayload,
        extractedPayload: { amount: SECRETS.parserPayload },
        description: SECRETS.description,
        subject: SECRETS.subject,
        text: SECRETS.notification,
        delivery: { text: SECRETS.notification, html: SECRETS.notification },
        connection: {
          accessTokenEncrypted: SECRETS.googleAccess,
          refreshTokenEncrypted: SECRETS.googleRefresh,
        },
        message: { snippet: SECRETS.rawBody },
      },
      'sync finished',
    );

  it('redacts tokens, keys, passwords, OAuth values, raw bodies, parser payloads, descriptions, and notification text', () => {
    const { logger, text } = capture();
    event(logger);
    expectNoSecret(text());
  });

  it('keeps the event name, ids, status, and error code searchable', () => {
    const { logger, records } = capture();
    event(logger);
    const [line] = records();
    expect(line).toMatchObject({
      event: 'email.sync.finished',
      ...IDS,
      status: 'PARTIAL_FAILED',
      errorCode: 'PROVIDER',
      msg: 'sync finished',
    });
  });

  it('scrubs credentials inside connection strings and bearer tokens inside free text', () => {
    const { logger, text } = capture();
    logger.error(
      `connect to postgresql://cashlens:${SECRETS.dbPassword}@db:5432/app failed`,
    );
    logger.warn(
      { detail: `retrying with Bearer ${SECRETS.bearer} and ${SECRETS.jwt}` },
      'provider refused',
    );
    logger.error(
      {
        err: new Error(
          `P1001 at postgresql://u:${SECRETS.dbPassword}@db/x, SMTP_PASSWORD=${SECRETS.smtpPassword}`,
        ),
      },
      'failed',
    );
    expectNoSecret(text());
    expect(text()).toContain('postgresql://cashlens:');
  });

  it('keeps an error class and code without its sensitive message fields', () => {
    const { logger, records } = capture();
    logger.error({
      event: 'request.failed',
      errorName: 'PrismaClientKnownRequestError',
      prismaCode: 'P2002',
      correlationId: IDS.correlationId,
    });
    expect(records()[0]).toMatchObject({
      errorName: 'PrismaClientKnownRequestError',
      prismaCode: 'P2002',
      correlationId: IDS.correlationId,
    });
  });
});

describe('review findings (T095 review)', () => {
  it('F1: drops transaction search text from request URLs', async () => {
    const { http, text } = capture();
    const server = createServer((req, res) => {
      http(req, res);
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/transactions?search=${encodeURIComponent(SECRETS.description)}&page=2`,
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expectNoSecret(text());
    expect(text()).toContain('page=2');
  });

  it('F3: redacts sensitive keys at any depth, in arrays, in any spelling', () => {
    const { logger, text } = capture();
    logger.info({
      event: 'deep',
      connection: { tokens: { refreshToken: SECRETS.googleRefresh } },
      items: [{ description: SECRETS.description }],
      grant: {
        access_token: SECRETS.googleAccess,
        id_token: SECRETS.jwt,
        client_secret: SECRETS.encryptionKey,
      },
      headers: {
        Authorization: `Bearer ${SECRETS.bearer}`,
        'Set-Cookie': SECRETS.setCookie,
      },
    });
    expectNoSecret(text());
  });

  it.each([
    ['JSON-style', `{"password":"${SECRETS.password}"}`, SECRETS.password],
    ['colon-quoted', `password: "${SECRETS.password}"`, SECRETS.password],
    [
      'URL-encoded',
      `a=1&password%3D${SECRETS.smtpPassword}&b=2`,
      SECRETS.smtpPassword,
    ],
    [
      'user-less URL',
      `redis://:${SECRETS.dbPassword}@cache:6379`,
      SECRETS.dbPassword,
    ],
    [
      'Google auth code',
      `exchange failed for 4/0AX4XfWhSYNTHcode123456`,
      '4/0AX4XfWhSYNTHcode123456',
    ],
    [
      'form body code',
      `code=${SECRETS.oauthState}&grant_type=authorization_code`,
      SECRETS.oauthState,
    ],
  ])('F4: scrubs a %s secret in free text', (_label, text, secret) => {
    expect(scrubText(text)).not.toContain(secret);
  });

  it('F4: leaves ordinary words alone (errorCode, status code values are fine)', () => {
    expect(scrubText('errorCode=PROVIDER status=FAILED')).toBe(
      'errorCode=PROVIDER status=FAILED',
    );
  });

  it('F5: scrubs a 60 KB alphanumeric string in linear time', () => {
    const big = 'a'.repeat(60_000);
    const started = Date.now();
    scrubText(big);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it('F6: a throwing getter never makes a log call throw', () => {
    const { logger, records } = capture();
    const hostile = {};
    Object.defineProperty(hostile, 'boom', {
      enumerable: true,
      get() {
        throw new Error(SECRETS.password);
      },
    });
    expect(() => logger.info({ event: 'x', hostile })).not.toThrow();
    expect(records()[0]).toMatchObject({ event: 'log.unserializable' });
  });

  it('F9: keeps the error class under pino-http', async () => {
    const lines: string[] = [];
    const http = pinoHttp(production(), {
      write: (line: string) => void lines.push(line),
    });
    class GmailApiError extends Error {}
    const server = createServer((req, res) => {
      http(req, res);
      res.statusCode = 500;
      (res as unknown as { err: Error }).err = new GmailApiError(
        `failed with token=${SECRETS.bearer}`,
      );
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => {
      httpRequest({ host: '127.0.0.1', port, path: '/x' }, (res) => {
        res.resume();
        res.on('end', resolve);
      }).end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const line = JSON.parse(lines[0]) as { err: { type: string } };
    expect(line.err.type).toBe('GmailApiError');
    expectNoSecret(lines.join('\n'));
  });
});
