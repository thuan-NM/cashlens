import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditActorType } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { TokenEncryptionService } from '../../common/security/token-encryption.service';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { SYNC_POLICY } from '../email-ingestion/sync-policy';
import { UsersRepository } from '../users/users.repository';
import { EmailConnectionsRepository } from './email-connections.repository';
import { toEmailConnectionResponse } from './email-connections.mapper';
import {
  GmailOAuthService,
  GmailReconnectRequiredError,
} from './gmail-oauth.service';

/**
 * A connection whose grant the provider refused (EXPIRED): only a new
 * consent flow recovers it, so nothing is sent to Google (EMAIL-003, ERR-003).
 */
export const reconnectRequired = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    message: 'Reconnect Gmail to continue synchronizing',
    error: 'Service Unavailable',
    code: 'RECONNECT_REQUIRED',
  });

/**
 * An access token is refreshed unless it outlives a whole sync lease, so a
 * 401 during a run means refused access, never natural expiry.
 */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = SYNC_POLICY.leaseTtlMs;

@Injectable()
export class EmailConnectionsService {
  constructor(
    private readonly repository: EmailConnectionsRepository,
    private readonly gmail: GmailOAuthService,
    private readonly encryption: TokenEncryptionService,
    private readonly users: UsersRepository,
    private readonly alerts: AlertEvaluationService,
  ) {}

  /** Starts a flow bound to the calling browser through the returned nonce. */
  connectGmail(user: RequestUser) {
    const nonce = this.gmail.createNonce();
    return {
      nonce,
      response: {
        authorizationUrl: this.gmail.authorizationUrl(user.id, nonce),
      },
    };
  }

  async completeGmail(code: string, state: unknown, nonce: unknown) {
    // State, browser binding, and account status are checked before Google is called.
    const userId = this.gmail.verifyState(state, nonce);
    if (!(await this.repository.isActiveUser(userId))) {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    const tokens = await this.gmail.exchangeCode(code);
    if (!tokens.refresh_token) {
      // Without offline access the connection could never sync again.
      throw new BadGatewayException(
        'Gmail did not grant offline access; connect again and approve access',
      );
    }
    const profile = await this.gmail.profile(tokens.access_token);

    const connection = await this.repository.upsert(
      userId,
      profile.emailAddress.trim().toLowerCase(),
      {
        provider: 'GMAIL',
        providerUserId: profile.emailAddress,
        accessTokenEncrypted: this.encryption.encrypt(tokens.access_token),
        refreshTokenEncrypted: this.encryption.encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope?.split(' ') ?? [],
        status: 'ACTIVE',
      },
    );

    // Sanitized evidence (SEC-006): no mailbox address, token, or provider payload.
    await this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: userId,
      action: 'EMAIL_CONNECTED',
      resourceType: 'email_connection',
      resourceId: connection.id,
      metadata: { provider: 'GMAIL' },
    });
    // A (re)connect resolves reconnect-required (ALERT-009).
    await this.alerts.onConnectionStatusChanged(userId);

    return toEmailConnectionResponse(connection);
  }

  async list(user: RequestUser) {
    return (await this.repository.listByUser(user.id)).map(
      toEmailConnectionResponse,
    );
  }

  async findOwned(userId: string, id: string) {
    const connection = await this.repository.findOwned(userId, id);
    if (!connection) throw new NotFoundException('Email connection not found');
    return connection;
  }

  /**
   * A usable access token for the owner's connection. A reconnect-required
   * connection is refused before Google is contacted; a refused refresh grant
   * turns the connection reconnect-required (distinct from a user disconnect).
   */
  async validAccessToken(userId: string, id: string) {
    const connection = await this.findOwned(userId, id);
    if (connection.status === 'EXPIRED' || connection.status === 'REVOKED') {
      throw reconnectRequired();
    }
    if (
      connection.tokenExpiresAt.getTime() >
      Date.now() + ACCESS_TOKEN_REFRESH_MARGIN_MS
    ) {
      return {
        connection,
        accessToken: this.encryption.decrypt(connection.accessTokenEncrypted),
      };
    }

    const refreshToken = this.encryption.decrypt(
      connection.refreshTokenEncrypted,
    );
    let tokens: Awaited<ReturnType<GmailOAuthService['refreshAccessToken']>>;
    try {
      tokens = await this.gmail.refreshAccessToken(refreshToken);
    } catch (error) {
      if (error instanceof GmailReconnectRequiredError) {
        await this.repository.markReconnectRequired(connection.id);
        // A provider-auth failure: reconnect-required (ALERT-009).
        await this.alerts.onConnectionStatusChanged(userId);
        throw reconnectRequired();
      }
      throw error;
    }
    const refreshed = {
      accessTokenEncrypted: this.encryption.encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? this.encryption.encrypt(tokens.refresh_token)
        : connection.refreshTokenEncrypted,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: 'ACTIVE' as const,
      errorMessage: null,
    };
    const saved = await this.repository.updateTokens(
      connection.id,
      connection.refreshTokenEncrypted,
      refreshed,
    );
    if (!saved) {
      // Disconnected (404) or reconnected meanwhile: the stored grant wins.
      const current = await this.findOwned(userId, id);
      return {
        connection: current,
        accessToken: this.encryption.decrypt(current.accessTokenEncrypted),
      };
    }
    return {
      connection: { ...connection, ...refreshed },
      accessToken: tokens.access_token,
    };
  }

  /**
   * User disconnect (DATA-002): best-effort provider revocation, then the
   * stored credentials are cleared whatever the provider answered. Derived
   * transactions and sanitized sync history are kept.
   */
  async disconnect(user: RequestUser, id: string) {
    const connection = await this.findOwned(user.id, id);
    const refreshToken = this.decryptOrNull(connection.refreshTokenEncrypted);
    if (refreshToken) {
      await this.gmail.revokeToken(refreshToken);
    }
    if (!(await this.repository.disconnect(user.id, id))) {
      throw new NotFoundException('Email connection not found');
    }
    await this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: 'EMAIL_DISCONNECTED',
      resourceType: 'email_connection',
      resourceId: id,
    });
    // A user disconnect never alerts; it resolves the connection's alerts.
    await this.alerts.onConnectionStatusChanged(user.id);
    return { id };
  }

  private decryptOrNull(value: string) {
    if (!value) return null;
    try {
      return this.encryption.decrypt(value);
    } catch {
      return null;
    }
  }
}
