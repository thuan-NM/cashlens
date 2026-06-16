import type { Prisma, User } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    timezone: user.timezone,
    locale: user.locale,
    baseCurrency: user.baseCurrency,
    status: user.status,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toCreateUserInput(dto: CreateUserDto): Prisma.UserCreateInput {
  return {
    email: dto.email,
    fullName: dto.fullName,
    timezone: dto.timezone,
    locale: dto.locale,
    baseCurrency: dto.baseCurrency,
    status: dto.status,
    metadata: dto.metadata as Prisma.InputJsonValue | undefined,
  };
}

export function toUpdateUserInput(dto: UpdateUserDto): Prisma.UserUpdateInput {
  return {
    fullName: dto.fullName,
    timezone: dto.timezone,
    locale: dto.locale,
    baseCurrency: dto.baseCurrency,
    status: dto.status,
    metadata: dto.metadata as Prisma.InputJsonValue | undefined,
  };
}
