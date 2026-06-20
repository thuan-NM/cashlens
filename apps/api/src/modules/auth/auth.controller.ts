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
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { AuthService } from './auth.service';
import { toAuthResponse } from './auth.mapper';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthSession } from './types/auth-session.type';
import { UserResponseDto } from '../users/dto/user-response.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<UserResponseDto> {
    return this.authService.register(dto, this.getRequestMeta(request));
  }

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

  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.refresh(
      request.cookies?.refreshToken,
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

  @HttpCode(200)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(request.cookies?.refreshToken);
    this.clearAuthCookies(response);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logoutAll(user);
    this.clearAuthCookies(response);
    return result;
  }

  private setAuthCookies(response: Response, session: AuthSession) {
    response.cookie('accessToken', session.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    response.cookie('refreshToken', session.refreshToken, {
      httpOnly: true,
      maxAge: session.refreshTokenMaxAgeMs,
      path: '/api/auth',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  private clearAuthCookies(response: Response) {
    response.clearCookie('accessToken');
    response.clearCookie('refreshToken', {
      path: '/api/auth',
    });
  }

  private getRequestMeta(request: Request) {
    return {
      userAgent: request.get('user-agent'),
      ipAddress: request.ip,
    };
  }
}
