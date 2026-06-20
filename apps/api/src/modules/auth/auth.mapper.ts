import type { Prisma } from '@prisma/client';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { AuthSession } from './types/auth-session.type';

export type AuthCreateUserInput = Prisma.UserCreateInput & {
  passwordHash: string;
};

export function toRegisterUserInput(
  dto: RegisterDto,
  passwordHash: string,
): AuthCreateUserInput {
  return {
    email: dto.email.trim().toLowerCase(),
    passwordHash,
    fullName: dto.fullName,
    timezone: dto.timezone,
    locale: dto.locale,
    baseCurrency: dto.baseCurrency,
    settings: {
      create: {},
    },
  };
}

export function toAuthResponse(session: AuthSession): AuthResponseDto {
  return {
    user: session.user,
  };
}
