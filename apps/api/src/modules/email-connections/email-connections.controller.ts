import {
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { BaseResponseDto } from '../../common/dto/base-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HttpsRequiredGuard } from '../../common/guards/https-required.guard';
import { correlationIdOf } from '../../common/http/correlation';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { ApiEnvelopedResponse } from '../../common/swagger/api-envelope';
import { EmailConnectionResponseDto } from './dto/email-connection.response';
import { EmailConnectionsService } from './email-connections.service';
import { GMAIL_OAUTH_FLOW_TTL_MS } from './gmail-oauth.service';

/** Binds a Gmail connect flow to the browser that started it (SEC-001). */
const OAUTH_NONCE_COOKIE = 'gmailOAuthNonce';
const OAUTH_CALLBACK_PATH = '/api/email-connections/gmail/callback';

/**
 * Fixed outcome codes the callback may put in the web app's URL. Nothing
 * from the request, the provider, or an error message ever reaches the URL.
 */
const CALLBACK_FAILURE_REASONS: Record<number, string> = {
  401: 'STATE_INVALID',
  502: 'GOOGLE_REFUSED',
  503: 'GOOGLE_UNAVAILABLE',
};

@Controller('email-connections')
export class EmailConnectionsController {
  private readonly logger = new Logger(EmailConnectionsController.name);

  constructor(
    private readonly service: EmailConnectionsService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('gmail/connect')
  connectGmail(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { nonce, response: body } = this.service.connectGmail(user);
    response.cookie(OAUTH_NONCE_COOKIE, nonce, {
      ...this.nonceCookieOptions(),
      maxAge: GMAIL_OAUTH_FLOW_TTL_MS,
    });
    return body;
  }

  /**
   * The OAuth redirect target, session-issuing: HTTPS only in production.
   * A browser navigation (Accept: text/html) is sent back to the web app's
   * Email page with a fixed outcome; an API client gets the enveloped
   * connection, or the error body, as before.
   */
  @UseGuards(HttpsRequiredGuard)
  @Get('gmail/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const nonce: unknown = request.cookies?.[OAUTH_NONCE_COOKIE];
    // Single use: the nonce is cleared whatever the outcome.
    response.clearCookie(OAUTH_NONCE_COOKIE, this.nonceCookieOptions());

    // JSON is listed first, so clients without a clear preference get JSON.
    const preferred: string | false = request.accepts(['json', 'html']);
    if (preferred !== 'html') {
      const connection = await this.service.completeGmail(code, state, nonce);
      response.json(
        new BaseResponseDto(connection, 'Success', correlationIdOf(request)),
      );
      return;
    }

    try {
      await this.service.completeGmail(code, state, nonce);
      response.redirect(303, this.emailPage('gmail=connected'));
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const reason = CALLBACK_FAILURE_REASONS[status] ?? 'FAILED';
      this.logger.warn({
        event: 'gmail.callback_failed',
        status,
        reason,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      response.redirect(
        303,
        this.emailPage(`gmail=failed&reason=${encodeURIComponent(reason)}`),
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiEnvelopedResponse(200, 'Owner connections (disconnected ones excluded)', {
    arrayOf: EmailConnectionResponseDto,
  })
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  disconnect(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.disconnect(user, id);
  }

  /** The web app's Email page on the configured origin, never the request's. */
  private emailPage(query: string): string {
    const origin = (this.config.get<string>('CORS_ORIGIN') ?? '')
      .split(',')[0]
      .trim();
    return `${origin}/app/email?${query}`;
  }

  private nonceCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      // Always Lax: Google's redirect back is a cross-site top-level navigation.
      sameSite: 'lax',
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      path: OAUTH_CALLBACK_PATH,
    };
  }
}
