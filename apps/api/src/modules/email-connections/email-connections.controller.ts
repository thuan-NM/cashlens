import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HttpsRequiredGuard } from '../../common/guards/https-required.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { EmailConnectionsService } from './email-connections.service';
import { GMAIL_OAUTH_FLOW_TTL_MS } from './gmail-oauth.service';

/** Binds a Gmail connect flow to the browser that started it (SEC-001). */
const OAUTH_NONCE_COOKIE = 'gmailOAuthNonce';
const OAUTH_CALLBACK_PATH = '/api/email-connections/gmail/callback';

@Controller('email-connections')
export class EmailConnectionsController {
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

  // The OAuth redirect target is session-issuing: HTTPS only in production.
  @UseGuards(HttpsRequiredGuard)
  @Get('gmail/callback')
  callback(
    @Query('code') code: string,
    @Query('state') state: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const nonce: unknown = request.cookies?.[OAUTH_NONCE_COOKIE];
    // Single use: the nonce is cleared whatever the outcome.
    response.clearCookie(OAUTH_NONCE_COOKIE, this.nonceCookieOptions());
    return this.service.completeGmail(code, state, nonce);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  disconnect(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.disconnect(user, id);
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
