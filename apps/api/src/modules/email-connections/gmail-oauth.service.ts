import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Upper bound of one call to a Google OAuth or profile endpoint. */
export const GMAIL_OAUTH_TIMEOUT_MS = 10_000;

/** Lifetime of one connect flow: the signed state and its nonce cookie. */
export const GMAIL_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/**
 * The provider refused the stored grant (revoked, expired, or invalid): only
 * a new consent flow can recover the connection (reconnect required). Its
 * message never carries a token or provider text.
 */
export class GmailReconnectRequiredError extends Error {
  constructor() {
    super('Gmail access must be reconnected');
  }
}

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
  private readonly scope = 'https://www.googleapis.com/auth/gmail.readonly';

  constructor(private readonly configService: ConfigService) {}

  /** A per-flow secret for the initiating browser (kept in an HttpOnly cookie). */
  createNonce(): string {
    return randomBytes(32).toString('base64url');
  }

  authorizationUrl(userId: string, nonce: string) {
    const params = new URLSearchParams({
      client_id: this.required('GMAIL_CLIENT_ID'),
      redirect_uri: this.required('GMAIL_REDIRECT_URI'),
      response_type: 'code',
      scope: this.scope,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: this.signState(userId, nonce),
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Returns the user who started the flow. The signed state binds the flow to
   * the browser that started it through the nonce hash, so a state completed
   * in any other browser is refused (SEC-001).
   */
  verifyState(state: unknown, nonce: unknown): string {
    const invalid = () => new UnauthorizedException('Invalid OAuth state');
    if (typeof state !== 'string' || typeof nonce !== 'string' || !nonce) {
      throw invalid();
    }
    const [payload, signature] = state.split('.');
    if (!payload || !signature) throw invalid();

    if (!this.sameValue(signature, this.signature(payload))) {
      throw invalid();
    }

    let parsed: { sub?: unknown; exp?: unknown; nonce?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        sub?: unknown;
        exp?: unknown;
        nonce?: unknown;
      };
    } catch {
      throw invalid();
    }
    if (typeof parsed.sub !== 'string' || !parsed.sub) throw invalid();
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      throw new UnauthorizedException('OAuth state expired');
    }
    if (
      typeof parsed.nonce !== 'string' ||
      !this.sameValue(parsed.nonce, this.nonceHash(nonce))
    ) {
      throw invalid();
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

    return this.requestToken(body, 'exchange');
  }

  async refreshAccessToken(refreshToken: string): Promise<GmailTokenResponse> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.required('GMAIL_CLIENT_ID'),
      client_secret: this.required('GMAIL_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    });

    return this.requestToken(body, 'refresh');
  }

  /**
   * Best-effort provider revocation on disconnect (DATA-002). The token goes
   * in a form body, never in the URL. It never throws: the local credentials
   * are cleared whatever the provider answers.
   */
  async revokeToken(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        signal: AbortSignal.timeout(GMAIL_OAUTH_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async profile(accessToken: string): Promise<GmailProfile> {
    let response: Response;
    try {
      response = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(GMAIL_OAUTH_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ServiceUnavailableException('Gmail is temporarily unavailable');
    }
    if (!response.ok) {
      throw new BadGatewayException('Unable to read Gmail profile');
    }
    return this.json<GmailProfile>(response, 'Unable to read Gmail profile');
  }

  /**
   * Token endpoint call with sanitized failures (EMAIL-002). Only
   * `invalid_grant` on refresh means the user's grant is gone (reconnect
   * required). Any other refresh refusal, such as a misconfigured client, is
   * an operator problem: a temporary 503 that leaves every connection as it
   * is. A provider outage is also 503; a refused code exchange is a generic
   * 502. Provider text is never copied.
   */
  private async requestToken(
    body: URLSearchParams,
    purpose: 'exchange' | 'refresh',
  ) {
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(GMAIL_OAUTH_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('Gmail is temporarily unavailable');
    }
    if (response.ok) {
      return this.json<GmailTokenResponse>(
        response,
        'Gmail OAuth token exchange failed',
      );
    }
    if (response.status >= 500) {
      throw new ServiceUnavailableException('Gmail is temporarily unavailable');
    }
    if (purpose === 'refresh') {
      if ((await this.tokenError(response)) === 'invalid_grant') {
        throw new GmailReconnectRequiredError();
      }
      throw new ServiceUnavailableException('Gmail is temporarily unavailable');
    }
    throw new BadGatewayException('Gmail OAuth token exchange failed');
  }

  /** A JSON body, or a generic 502: a parse error could quote the body. */
  private async json<T>(response: Response, failure: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException(failure);
    }
  }

  /** Google's OAuth error code only; the description is never read. */
  private async tokenError(response: Response) {
    try {
      const body = (await response.json()) as { error?: unknown };
      return typeof body.error === 'string' ? body.error : '';
    } catch {
      return '';
    }
  }

  private signState(userId: string, nonce: string) {
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        exp: Date.now() + GMAIL_OAUTH_FLOW_TTL_MS,
        nonce: this.nonceHash(nonce),
      }),
    ).toString('base64url');
    return `${payload}.${this.signature(payload)}`;
  }

  private nonceHash(nonce: string) {
    return createHash('sha256').update(nonce).digest('base64url');
  }

  private sameValue(actual: string, expected: string) {
    const actualBuffer = Buffer.from(actual, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
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
