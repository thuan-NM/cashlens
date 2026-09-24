import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { RequestUser } from '../../../common/types/request-user.type';
import { UsersRepository } from '../../users/users.repository';

export type JwtPayload = {
  sub: string;
  email?: string;
  role?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersRepository: UsersRepository,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        JwtStrategy.extractTokenFromCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * A valid signature is not enough: the account must still exist and be
   * ACTIVE, and its role comes from the database. A disabled or deleted
   * account's unexpired token gets the same 401 as a missing session.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = payload.sub
      ? await this.usersRepository.findActiveForAuth(payload.sub)
      : null;

    if (!user) {
      throw new UnauthorizedException();
    }

    return { id: user.id, email: user.email, role: user.role };
  }

  private static readonly extractTokenFromCookie = (
    request: Request,
  ): string | null => {
    const token: unknown = request.cookies?.accessToken;
    return typeof token === 'string' ? token : null;
  };
}
