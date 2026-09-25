import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
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
import { AuthService } from './auth.service';
import { toAuthResponse } from './auth.mapper';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthSession } from './types/auth-session.type';
import { UserResponseDto } from '../users/dto/user-response.dto';

const REFRESH_COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // Session-issuing routes require HTTPS in production (OPS-009).
  @UseGuards(HttpsRequiredGuard)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<UserResponseDto> {
    return this.authService.register(dto, this.getRequestMeta(request));
  }

  @UseGuards(HttpsRequiredGuard)
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.login(
      dto,
      this.getRequestMeta(request),
    );
    this.setAuthCookies(response, session);
    return toAuthResponse(session);
  }

  @UseGuards(HttpsRequiredGuard)
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.refresh(
      this.refreshTokenFrom(request),
      this.getRequestMeta(request),
    );
    this.setAuthCookies(response, session);
    return toAuthResponse(session);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.authService.me(user);
  }

  @UseGuards(HttpsRequiredGuard)
  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(
      this.refreshTokenFrom(request),
      this.getRequestMeta(request),
    );
    this.clearAuthCookies(response);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logoutAll(
      user,
      this.getRequestMeta(request),
    );
    this.clearAuthCookies(response);
    return result;
  }

  // Cookie flags come from validated configuration (AUTH-003): Secure and
  // SameSite follow COOKIE_SECURE and COOKIE_SAME_SITE; both are HttpOnly.
  private cookieOptions(path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite:
        this.config.get<string>('COOKIE_SAME_SITE') === 'strict'
          ? 'strict'
          : 'lax',
      path,
    };
  }

  private setAuthCookies(response: Response, session: AuthSession) {
    response.cookie(
      'accessToken',
      session.accessToken,
      this.cookieOptions('/'),
    );

    response.cookie('refreshToken', session.refreshToken, {
      ...this.cookieOptions(REFRESH_COOKIE_PATH),
      maxAge: session.refreshTokenMaxAgeMs,
    });
  }

  private clearAuthCookies(response: Response) {
    response.clearCookie('accessToken', this.cookieOptions('/'));
    response.clearCookie(
      'refreshToken',
      this.cookieOptions(REFRESH_COOKIE_PATH),
    );
  }

  /**
   * The refresh-token cookie, only when it is a string. cookie-parser turns
   * `j:`-prefixed values into objects, which are treated as no token.
   */
  private refreshTokenFrom(request: Request): string | undefined {
    const token: unknown = request.cookies?.refreshToken;
    return typeof token === 'string' ? token : undefined;
  }

  private getRequestMeta(request: Request) {
    return {
      userAgent: request.get('user-agent'),
      // Trust-proxy aware: the client address as seen through TRUST_PROXY hops.
      ipAddress: request.ip,
    };
  }
}
