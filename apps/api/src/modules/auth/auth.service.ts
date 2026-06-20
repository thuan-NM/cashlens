import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditActorType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { UsersRepository } from '../users/users.repository';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/users.mapper';
import { toRegisterUserInput } from './auth.mapper';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthSession } from './types/auth-session.type';

export type AuthRequestMeta = {
  userAgent?: string;
  ipAddress?: string;
};

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlDays: number;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.refreshTokenTtlDays = Number(
      configService.get<string>('JWT_REFRESH_EXPIRES_IN_DAYS') ?? 30,
    );
  }

  async register(
    dto: RegisterDto,
    meta: AuthRequestMeta = {},
  ): Promise<UserResponseDto> {
    const existingUser = await this.usersRepository.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersRepository.create(
      toRegisterUserInput(dto, passwordHash),
    );

    await this.writeAuditLog(user.id, 'REGISTER', 'users', user.id, meta);

    return toUserResponse(user);
  }

  async login(
    dto: LoginDto,
    meta: AuthRequestMeta = {},
  ): Promise<AuthSession> {
    const user = await this.usersRepository.findByEmailForAuth(dto.email);

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const updatedUser = await this.usersRepository.updateLastLogin(user.id);

    await this.writeAuditLog(user.id, 'LOGIN', 'users', user.id, meta);

    return this.buildAuthResponse(
      updatedUser.id,
      updatedUser.email,
      toUserResponse(updatedUser),
      meta,
    );
  }

  async refresh(
    refreshToken: string | undefined,
    meta: AuthRequestMeta = {},
  ): Promise<AuthSession> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokenHash = this.hashRefreshToken(refreshToken);
    const storedToken =
      await this.usersRepository.findActiveRefreshToken(tokenHash);

    if (!storedToken || storedToken.user.deletedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.usersRepository.revokeRefreshToken(tokenHash);
    await this.writeAuditLog(
      storedToken.user.id,
      'REFRESH_TOKEN',
      'refresh_tokens',
      storedToken.id,
      meta,
    );

    return this.buildAuthResponse(
      storedToken.user.id,
      storedToken.user.email,
      toUserResponse(storedToken.user),
      meta,
    );
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.usersRepository.revokeRefreshToken(
        this.hashRefreshToken(refreshToken),
      );
    }

    return { loggedOut: true };
  }

  async logoutAll(user: RequestUser) {
    await this.usersRepository.revokeAllRefreshTokens(user.id);
    await this.writeAuditLog(user.id, 'LOGOUT_ALL', 'refresh_tokens', null, {});

    return { loggedOut: true };
  }

  async me(user: RequestUser) {
    const existingUser = await this.usersRepository.findById(user.id);

    if (!existingUser) {
      throw new UnauthorizedException('User not found');
    }

    return toUserResponse(existingUser);
  }

  private async buildAuthResponse(
    userId: string,
    email: string,
    user: UserResponseDto,
    meta: AuthRequestMeta,
  ): Promise<AuthSession> {
    const refreshToken = this.generateRefreshToken();

    await this.createRefreshToken(userId, refreshToken, meta);

    return {
      accessToken: this.jwtService.sign({ sub: userId, email, role: user.role }),
      refreshToken,
      refreshTokenMaxAgeMs:
        this.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
      user,
    };
  }

  private async createRefreshToken(
    userId: string,
    refreshToken: string,
    meta: AuthRequestMeta,
  ) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenTtlDays);

    await this.usersRepository.createRefreshToken({
      user: {
        connect: {
          id: userId,
        },
      },
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
  }

  private generateRefreshToken(): string {
    return randomBytes(64).toString('base64url');
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }

  private async writeAuditLog(
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    meta: AuthRequestMeta,
  ) {
    await this.usersRepository.createAuditLog({
      user: {
        connect: {
          id: userId,
        },
      },
      actorType: AuditActorType.USER,
      action,
      resourceType,
      resourceId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}
