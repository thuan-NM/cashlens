import {
  BadGatewayException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EmailConnection } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { TokenEncryptionService } from '../../common/security/token-encryption.service';
import type { UsersRepository } from '../users/users.repository';
import { toEmailConnectionResponse } from './email-connections.mapper';
import type { EmailConnectionsRepository } from './email-connections.repository';
import { EmailConnectionsService } from './email-connections.service';
import {
  GMAIL_OAUTH_FLOW_TTL_MS,
  GmailOAuthService,
  GmailReconnectRequiredError,
} from './gmail-oauth.service';

// T037 (EMAIL-001–EMAIL-003, TEST-004): Gmail OAuth state, scope, token
// redaction, revocation, reconnect, and provider-auth-failure versus
// user-disconnect status. Every credential below is generated per run.

const synthetic = () => randomBytes(24).toString('base64url');
const settings: Record<string, string> = {
  GMAIL_CLIENT_ID: `t037-${synthetic()}.apps.googleusercontent.test`,
  GMAIL_CLIENT_SECRET: synthetic(),
  GMAIL_REDIRECT_URI:
    'https://cashlens.example.test/api/email-connections/gmail/callback',
  GMAIL_OAUTH_STATE_SECRET: synthetic(),
};
const config = {
  get: (name: string) => settings[name],
} as unknown as ConfigService;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Everything an error could carry to a client or a log line. */
const errorText = (error: unknown) =>
  error instanceof HttpException
    ? `${error.message} ${JSON.stringify(error.getResponse())}`
    : String(error instanceof Error ? error.message : error);

const connection = (over: Partial<EmailConnection> = {}): EmailConnection => ({
  id: 'conn-1',
  userId: 'user-1',
  provider: 'GMAIL',
  emailAddress: 'owner@example.test',
  providerUserId: 'owner@example.test',
  accessTokenEncrypted: 'enc(access-token)',
  refreshTokenEncrypted: 'enc(refresh-token)',
  tokenExpiresAt: new Date(Date.now() - 60_000),
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  status: 'ACTIVE',
  lastSyncedAt: null,
  connectedAt: new Date('2026-09-01T00:00:00.000Z'),
  disconnectedAt: null,
  errorMessage: null,
  lastFailedAt: null,
  syncCursor: null,
  backfillFrom: null,
  backfillCompletedAt: null,
  syncLeaseToken: null,
  syncLeaseExpiresAt: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  ...over,
});

describe('GmailOAuthService (T037)', () => {
  let service: GmailOAuthService;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new GmailOAuthService(config);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('consent request (EMAIL-001)', () => {
    it('asks for read-only Gmail access with offline consent and nothing else', () => {
      const url = new URL(service.authorizationUrl('user-1', 'nonce-1'));
      expect(url.origin + url.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(url.searchParams.get('scope')).toBe(
        'https://www.googleapis.com/auth/gmail.readonly',
      );
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect([...url.searchParams.keys()].sort()).toEqual(
        [
          'access_type',
          'client_id',
          'include_granted_scopes',
          'prompt',
          'redirect_uri',
          'response_type',
          'scope',
          'state',
        ].sort(),
      );
    });
  });

  describe('signed, expiring, browser-bound state', () => {
    const stateFor = (userId: string, nonce: string) =>
      new URL(service.authorizationUrl(userId, nonce)).searchParams.get(
        'state',
      )!;

    it('returns the user who started the flow in the same browser', () => {
      const nonce = service.createNonce();
      expect(service.verifyState(stateFor('user-1', nonce), nonce)).toBe(
        'user-1',
      );
    });

    it('refuses a tampered payload or signature, another browser, or no nonce', () => {
      const nonce = service.createNonce();
      const state = stateFor('user-1', nonce);
      const [payload, signature] = state.split('.');
      const forged = Buffer.from(
        JSON.stringify({ sub: 'user-2', exp: Date.now() + 60_000 }),
      ).toString('base64url');
      for (const [candidate, browserNonce] of [
        [`${forged}.${signature}`, nonce],
        [`${payload}.${signature.slice(0, -2)}xx`, nonce],
        [state, service.createNonce()],
        [state, ''],
        [state, undefined],
        [undefined, nonce],
      ]) {
        expect(() => service.verifyState(candidate, browserNonce)).toThrow(
          UnauthorizedException,
        );
      }
    });

    it('expires after the flow lifetime', () => {
      jest.useFakeTimers({ now: new Date('2026-09-24T03:00:00.000Z') });
      const nonce = service.createNonce();
      const state = stateFor('user-1', nonce);
      jest.setSystemTime(Date.now() + GMAIL_OAUTH_FLOW_TTL_MS + 1);
      expect(() => service.verifyState(state, nonce)).toThrow(
        'OAuth state expired',
      );
    });
  });

  describe('provider errors never carry credentials (EMAIL-002)', () => {
    it('a failed code exchange is a generic 502 without the code, secret, or provider body', async () => {
      const code = synthetic();
      fetchSpy.mockResolvedValue(
        jsonResponse(400, {
          error: 'invalid_grant',
          error_description: `bad code ${code} for ${settings.GMAIL_CLIENT_SECRET}`,
        }),
      );
      const failure = await service.exchangeCode(code).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(BadGatewayException);
      const text = errorText(failure);
      for (const secret of [
        code,
        settings.GMAIL_CLIENT_SECRET,
        'invalid_grant',
      ]) {
        expect(text.includes(secret)).toBe(false);
      }
    });

    it('a refused refresh grant means reconnect required, without the token', async () => {
      const refreshToken = synthetic();
      fetchSpy.mockResolvedValue(
        jsonResponse(400, {
          error: 'invalid_grant',
          error_description: `Token ${refreshToken} has been expired or revoked.`,
        }),
      );
      const failure = await service
        .refreshAccessToken(refreshToken)
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(GmailReconnectRequiredError);
      expect(errorText(failure).includes(refreshToken)).toBe(false);
    });

    it('a provider outage during refresh is not a reconnect', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, { error: 'backendError' }));
      const failure = await service
        .refreshAccessToken(synthetic())
        .catch((e: unknown) => e);
      expect(failure).not.toBeInstanceOf(GmailReconnectRequiredError);
      expect(failure).toBeInstanceOf(HttpException);
    });

    it('a client misconfiguration during refresh is a temporary failure, never a reconnect', async () => {
      // Only invalid_grant means the user's grant is gone; a wrong client
      // secret must not force every user through consent again.
      for (const [status, error] of [
        [401, 'invalid_client'],
        [400, 'unauthorized_client'],
        [401, ''],
      ] as const) {
        fetchSpy.mockResolvedValueOnce(
          jsonResponse(status, {
            error,
            error_description: `client ${settings.GMAIL_CLIENT_SECRET} unknown`,
          }),
        );
        const failure = await service
          .refreshAccessToken(synthetic())
          .catch((e: unknown) => e);
        expect([status, error, failure]).toEqual([
          status,
          error,
          expect.any(ServiceUnavailableException),
        ]);
        expect(errorText(failure).includes(settings.GMAIL_CLIENT_SECRET)).toBe(
          false,
        );
      }
    });

    it('a success answer that is not JSON is a generic failure without provider text', async () => {
      const fragment = `<html>${synthetic()}`;
      for (const call of [
        () => service.exchangeCode(synthetic()),
        () => service.profile(synthetic()),
      ]) {
        fetchSpy.mockResolvedValueOnce(new Response(fragment, { status: 200 }));
        const failure = await call().catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(HttpException);
        expect(errorText(failure).includes(fragment.slice(0, 8))).toBe(false);
      }
    });
  });

  describe('best-effort revocation (DATA-002)', () => {
    it('posts the token in a form body, never in the URL', async () => {
      const token = synthetic();
      fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
      await expect(service.revokeToken(token)).resolves.toBe(true);
      const [url, init] = fetchSpy.mock.calls[0];
      const target = (url as string | URL).toString();
      expect(target).toBe('https://oauth2.googleapis.com/revoke');
      expect(target.includes(token)).toBe(false);
      expect(init?.method).toBe('POST');
      expect(String(init?.body as string | URLSearchParams | undefined)).toBe(
        new URLSearchParams({ token }).toString(),
      );
    });

    it('never throws when the provider refuses or is unreachable', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(400, { error: 'invalid_token' }),
      );
      await expect(service.revokeToken(synthetic())).resolves.toBe(false);
      fetchSpy.mockRejectedValueOnce(new Error('network down'));
      await expect(service.revokeToken(synthetic())).resolves.toBe(false);
    });
  });
});

describe('EmailConnectionsService status and recovery (T037)', () => {
  const encryption = {
    encrypt: (value: string) => `enc(${value})`,
    decrypt: (value: string) => value.replace(/^enc\((.*)\)$/, '$1'),
  } as unknown as TokenEncryptionService;
  const users = {
    recordAudit: jest.fn().mockResolvedValue(undefined),
  } as unknown as UsersRepository;

  const build = (
    repository: Partial<Record<keyof EmailConnectionsRepository, jest.Mock>>,
    gmail: Partial<Record<keyof GmailOAuthService, jest.Mock>>,
  ) =>
    new EmailConnectionsService(
      repository as unknown as EmailConnectionsRepository,
      gmail as unknown as GmailOAuthService,
      encryption,
      users,
    );

  it('a user disconnect revokes best-effort, clears credentials, and is not reconnect-required', async () => {
    const repository = {
      findOwned: jest.fn().mockResolvedValue(connection()),
      disconnect: jest
        .fn()
        .mockResolvedValue(
          connection({ status: 'REVOKED', disconnectedAt: new Date() }),
        ),
    };
    const gmail = { revokeToken: jest.fn().mockResolvedValue(false) };
    await expect(
      build(repository, gmail).disconnect({ id: 'user-1' }, 'conn-1'),
    ).resolves.toEqual({ id: 'conn-1' });
    // Revocation failed at the provider; the local credentials are still cleared.
    expect(gmail.revokeToken).toHaveBeenCalledWith('refresh-token');
    expect(repository.disconnect).toHaveBeenCalledWith('user-1', 'conn-1');
  });

  it('a refused grant marks the connection reconnect-required with a generic 503', async () => {
    const repository = {
      findOwned: jest.fn().mockResolvedValue(connection()),
      markReconnectRequired: jest.fn().mockResolvedValue(undefined),
      updateTokens: jest.fn(),
    };
    const gmail = {
      refreshAccessToken: jest
        .fn()
        .mockRejectedValue(new GmailReconnectRequiredError()),
    };
    const failure = await build(repository, gmail)
      .validAccessToken('user-1', 'conn-1')
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(503);
    expect((failure as HttpException).getResponse()).toMatchObject({
      code: 'RECONNECT_REQUIRED',
    });
    expect(repository.markReconnectRequired).toHaveBeenCalledWith('conn-1');
    expect(repository.updateTokens).not.toHaveBeenCalled();
    expect(errorText(failure).includes('refresh-token')).toBe(false);
  });

  it('a refresh that races a disconnect never writes credentials back (DATA-002)', async () => {
    const stale = connection({ tokenExpiresAt: new Date(Date.now() - 1000) });
    const repository = {
      findOwned: jest
        .fn()
        .mockResolvedValueOnce(stale)
        // Disconnected while Google answered the refresh.
        .mockResolvedValueOnce(null),
      // The guarded write matches nothing: the row is no longer connected.
      updateTokens: jest.fn().mockResolvedValue(0),
    };
    const gmail = {
      refreshAccessToken: jest.fn().mockResolvedValue({
        access_token: 'fresh-access',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    };
    const failure = await build(repository, gmail)
      .validAccessToken('user-1', 'conn-1')
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(NotFoundException);
    expect(repository.updateTokens).toHaveBeenCalledWith(
      'conn-1',
      stale.refreshTokenEncrypted,
      expect.objectContaining({ status: 'ACTIVE' }),
    );
  });

  it('a reconnect-required connection is refused before Google is contacted', async () => {
    const repository = {
      findOwned: jest.fn().mockResolvedValue(connection({ status: 'EXPIRED' })),
    };
    const gmail = { refreshAccessToken: jest.fn() };
    const failure = await build(repository, gmail)
      .validAccessToken('user-1', 'conn-1')
      .catch((e: unknown) => e);
    expect((failure as HttpException).getStatus()).toBe(503);
    expect(gmail.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('a missing refresh token is a generic provider error, not a server error', async () => {
    const repository = {
      isActiveUser: jest.fn().mockResolvedValue(true),
      upsert: jest.fn(),
    };
    const gmail = {
      verifyState: jest.fn().mockReturnValue('user-1'),
      exchangeCode: jest.fn().mockResolvedValue({
        access_token: synthetic(),
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      profile: jest.fn().mockResolvedValue({
        emailAddress: 'owner@example.test',
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1',
      }),
    };
    const failure = await build(repository, gmail)
      .completeGmail('code', 'state', 'nonce')
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(BadGatewayException);
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('reconnecting the same mailbox restores the existing connection to ACTIVE', async () => {
    const restored = connection({
      status: 'ACTIVE',
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const repository = {
      isActiveUser: jest.fn().mockResolvedValue(true),
      upsert: jest.fn().mockResolvedValue(restored),
    };
    const gmail = {
      verifyState: jest.fn().mockReturnValue('user-1'),
      exchangeCode: jest.fn().mockResolvedValue({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      }),
      profile: jest.fn().mockResolvedValue({
        emailAddress: 'Owner@Example.test',
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: '1',
      }),
    };
    const response = await build(repository, gmail).completeGmail(
      'code',
      'state',
      'nonce',
    );
    const [userId, mailbox, data] = repository.upsert.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect([userId, mailbox]).toEqual(['user-1', 'owner@example.test']);
    expect(data).toMatchObject({
      status: 'ACTIVE',
      accessTokenEncrypted: 'enc(new-access)',
      refreshTokenEncrypted: 'enc(new-refresh)',
    });
    expect(response).toMatchObject({
      id: 'conn-1',
      status: 'ACTIVE',
      reconnectRequired: false,
      recoveryAction: 'NONE',
    });
  });

  it('responses report the recovery action and never carry credentials (EMAIL-003)', () => {
    const cases: Array<[Partial<EmailConnection>, boolean, string]> = [
      [{ status: 'ACTIVE' }, false, 'NONE'],
      [
        { status: 'EXPIRED', errorMessage: 'Reconnect required' },
        true,
        'RECONNECT',
      ],
      [
        { status: 'ERROR', errorMessage: 'Gmail is unavailable' },
        false,
        'RETRY',
      ],
      [{ status: 'REVOKED', disconnectedAt: new Date() }, false, 'CONNECT'],
    ];
    for (const [over, reconnectRequired, recoveryAction] of cases) {
      const response = toEmailConnectionResponse(connection(over));
      expect(response).toMatchObject({ reconnectRequired, recoveryAction });
      const text = JSON.stringify(response);
      expect(text.includes('access-token')).toBe(false);
      expect(text.includes('refresh-token')).toBe(false);
      expect(Object.keys(response)).not.toContain('accessTokenEncrypted');
      expect(Object.keys(response)).not.toContain('refreshTokenEncrypted');
    }
  });
});
