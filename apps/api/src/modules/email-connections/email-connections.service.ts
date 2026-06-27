import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestUser } from '../../common/types/request-user.type';
import { TokenEncryptionService } from '../../common/security/token-encryption.service';
import { EmailConnectionsRepository } from './email-connections.repository';
import { toEmailConnectionResponse } from './email-connections.mapper';
import { GmailOAuthService } from './gmail-oauth.service';

@Injectable()
export class EmailConnectionsService {
  constructor(
    private readonly repository: EmailConnectionsRepository,
    private readonly gmail: GmailOAuthService,
    private readonly encryption: TokenEncryptionService,
  ) {}

  connectGmail(user: RequestUser) {
    return { authorizationUrl: this.gmail.authorizationUrl(user.id) };
  }

  async completeGmail(code: string, state: string) {
    const userId = this.gmail.verifyState(state);
    const tokens = await this.gmail.exchangeCode(code);
    const profile = await this.gmail.profile(tokens.access_token);
    if (!tokens.refresh_token) {
      throw new Error('Gmail did not return a refresh token');
    }

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

  async validAccessToken(userId: string, id: string) {
    const connection = await this.findOwned(userId, id);
    if (
      connection.status === 'ACTIVE' &&
      connection.tokenExpiresAt.getTime() > Date.now() + 60_000
    ) {
      return {
        connection,
        accessToken: this.encryption.decrypt(
          connection.accessTokenEncrypted,
        ),
      };
    }

    const refreshToken = this.encryption.decrypt(
      connection.refreshTokenEncrypted,
    );
    const tokens = await this.gmail.refreshAccessToken(refreshToken);
    const updated = await this.repository.updateTokens(connection.id, {
      accessTokenEncrypted: this.encryption.encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? this.encryption.encrypt(tokens.refresh_token)
        : connection.refreshTokenEncrypted,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: 'ACTIVE',
      errorMessage: null,
    });

    return { connection: updated, accessToken: tokens.access_token };
  }

  async disconnect(user: RequestUser, id: string) {
    await this.findOwned(user.id, id);
    await this.repository.disconnect(id);
    return { id };
  }
}
