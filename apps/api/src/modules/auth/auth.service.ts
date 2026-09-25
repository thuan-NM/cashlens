import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditActorType, Prisma, UserStatus } from '@prisma/client';
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
  private readonly logger = new Logger(AuthService.name);

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
    const user = await this.usersRepository
      .create(toRegisterUserInput(dto, passwordHash))
      .catch((error: unknown) => {
        // A concurrent or soft-deleted duplicate gets the same answer as above.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Email already exists');
        }
        throw error;
      });

    await this.writeAuditLog(user.id, 'REGISTER', 'users', user.id, meta);

    return toUserResponse(user);
  }

  async login(dto: LoginDto, meta: AuthRequestMeta = {}): Promise<AuthSession> {
    const user = await this.usersRepository.findByEmailForAuth(dto.email);

    if (!user?.passwordHash) {
      // Same bcrypt cost as a real check, so timing does not reveal whether
      // the account exists (AUTH-004).
      await bcrypt.compare(dto.password, await this.dummyPasswordHash());
      // No account id to record: the event carries neither email nor password.
      this.logger.warn({ event: 'auth.login_failed', reason: 'NO_ACCOUNT' });
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    // A disabled or pending-deletion account gets the same generic failure,
    // checked after the password so its status is never disclosed (AUTH-002).
    if (!isPasswordValid || user.status !== UserStatus.ACTIVE) {
      // Audited without the submitted email or password (AUTH-005).
      await this.writeAuditLog(user.id, 'LOGIN_FAILED', 'users', user.id, meta);
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

    if (
      !storedToken ||
      storedToken.user.deletedAt ||
      storedToken.user.status !== UserStatus.ACTIVE
    ) {
      this.logger.warn({
        event: 'auth.refresh_rejected',
        reason: storedToken ? 'ACCOUNT_INACTIVE' : 'UNKNOWN_TOKEN',
        userId: storedToken?.user.id,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotation is atomic: of two requests replaying one token, only the one
    // that actually revokes it gets a new session.
    const { count } = await this.usersRepository.revokeRefreshToken(tokenHash);
    if (count !== 1) {
      // A concurrent or replayed refresh of an already rotated token.
      this.logger.warn({
        event: 'auth.refresh_rejected',
        reason: 'ALREADY_ROTATED',
        userId: storedToken.user.id,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
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

  async logout(refreshToken?: string, meta: AuthRequestMeta = {}) {
    if (refreshToken) {
      const tokenHash = this.hashRefreshToken(refreshToken);
      const storedToken =
        await this.usersRepository.findActiveRefreshToken(tokenHash);
      const { count } =
        await this.usersRepository.revokeRefreshToken(tokenHash);

      if (storedToken && count === 1) {
        await this.writeAuditLog(
          storedToken.user.id,
          'LOGOUT',
          'refresh_tokens',
          storedToken.id,
          meta,
        );
      }
    }

    return { loggedOut: true };
  }

  async logoutAll(user: RequestUser, meta: AuthRequestMeta = {}) {
    await this.usersRepository.revokeAllRefreshTokens(user.id);
    await this.writeAuditLog(
      user.id,
      'LOGOUT_ALL',
      'refresh_tokens',
      null,
      meta,
    );

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
      accessToken: this.jwtService.sign({
        sub: userId,
        email,
        role: user.role,
      }),
      refreshToken,
      refreshTokenMaxAgeMs: this.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
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

  private dummyHash?: Promise<string>;

  private dummyPasswordHash(): Promise<string> {
    this.dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), 12);
    return this.dummyHash;
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
      // Sanitized: request metadata only, bounded; never a credential (AUTH-005).
      ipAddress: meta.ipAddress?.slice(0, 64),
      userAgent: meta.userAgent?.slice(0, 255),
    });
    // The same fact as the audit row, searchable by the correlation id.
    const log = action === 'LOGIN_FAILED' ? 'warn' : 'log';
    this.logger[log]({
      event: `auth.${action.toLowerCase()}`,
      userId,
      resourceType,
      resourceId,
    });
  }
}
