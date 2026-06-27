import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

type GmailTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
};

type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

@Injectable()
export class GmailOAuthService {
  private readonly scope =
    'https://www.googleapis.com/auth/gmail.readonly';

  constructor(private readonly configService: ConfigService) {}

  authorizationUrl(userId: string) {
    const params = new URLSearchParams({
      client_id: this.required('GMAIL_CLIENT_ID'),
      redirect_uri: this.required('GMAIL_REDIRECT_URI'),
      response_type: 'code',
      scope: this.scope,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: this.signState(userId),
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  verifyState(state: string): string {
    const [payload, signature] = state.split('.');
    if (!payload || !signature) throw new UnauthorizedException('Invalid OAuth state');

    const expected = this.signature(payload);
    const actualBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid OAuth state');
    }

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub: string;
      exp: number;
    };
    if (!parsed.sub || parsed.exp < Date.now()) {
      throw new UnauthorizedException('OAuth state expired');
    }

    return parsed.sub;
  }

  async exchangeCode(code: string): Promise<GmailTokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: this.required('GMAIL_CLIENT_ID'),
      client_secret: this.required('GMAIL_CLIENT_SECRET'),
      redirect_uri: this.required('GMAIL_REDIRECT_URI'),
      grant_type: 'authorization_code',
    });

    return this.requestToken(body);
  }

  async refreshAccessToken(refreshToken: string): Promise<GmailTokenResponse> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.required('GMAIL_CLIENT_ID'),
      client_secret: this.required('GMAIL_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    });

    return this.requestToken(body);
  }

  async profile(accessToken: string): Promise<GmailProfile> {
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      throw new BadGatewayException('Unable to read Gmail profile');
    }
    return response.json() as Promise<GmailProfile>;
  }

  private async requestToken(body: URLSearchParams) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new BadGatewayException('Gmail OAuth token exchange failed');
    }
    return response.json() as Promise<GmailTokenResponse>;
  }

  private signState(userId: string) {
    const payload = Buffer.from(
      JSON.stringify({ sub: userId, exp: Date.now() + 10 * 60 * 1000 }),
    ).toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }

  private signature(payload: string) {
    const secret =
      this.configService.get<string>('GMAIL_OAUTH_STATE_SECRET') ??
      this.required('JWT_SECRET');
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private required(name: string) {
    const value = this.configService.get<string>(name);
    if (!value) {
      throw new ServiceUnavailableException(`${name} is not configured`);
    }
    return value;
  }
}
