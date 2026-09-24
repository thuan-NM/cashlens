import type { Prisma, User } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdminUserResponseDto, UserResponseDto } from './dto/user-response.dto';

type UserWithSettings = User & {
  settings?: {
    storeRawEmailBody: boolean;
    allowAiInsights: boolean;
    autoClassificationEnabled: boolean;
    defaultMonthStartDay: number;
    dataRetentionDays: number | null;
    notificationEnabled: boolean;
    metadata: Prisma.JsonValue | null;
  } | null;
};

export function toUserResponse(user: UserWithSettings): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    timezone: user.timezone,
    locale: user.locale,
    baseCurrency: user.baseCurrency,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    settings: user.settings
      ? {
          storeRawEmailBody: user.settings.storeRawEmailBody,
          // DATA-001: a stored value (even a legacy true) has no effect.
          rawEmailBodyAvailable: false,
          allowAiInsights: user.settings.allowAiInsights,
          autoClassificationEnabled: user.settings.autoClassificationEnabled,
          defaultMonthStartDay: user.settings.defaultMonthStartDay,
          dataRetentionDays: user.settings.dataRetentionDays,
          notificationEnabled: user.settings.notificationEnabled,
          metadata: user.settings.metadata as Record<string, unknown> | null,
        }
      : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Administrator view of an account: identity and status only. Settings and
 * metadata stay private to the account owner (SEC-008, contract AdminUserWrite).
 */
export function toAdminUserResponse(user: User): AdminUserResponseDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    timezone: user.timezone,
    locale: user.locale,
    baseCurrency: user.baseCurrency,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toUpdateMyProfileInput(
  dto: UpdateMyProfileDto,
): Prisma.UserUpdateInput {
  return {
    fullName: dto.fullName,
    timezone: dto.timezone,
    locale: dto.locale,
    baseCurrency: dto.baseCurrency,
  };
}

export function toCreateUserInput(dto: CreateUserDto): Prisma.UserCreateInput {
  return {
    email: dto.email.trim().toLowerCase(),
    fullName: dto.fullName,
    role: dto.role,
    timezone: dto.timezone,
    locale: dto.locale,
    baseCurrency: dto.baseCurrency,
    status: dto.status,
    metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    settings: {
      create: {},
    },
  };
}

export function toUpdateUserInput(dto: UpdateUserDto): Prisma.UserUpdateInput {
  return {
    fullName: dto.fullName,
    role: dto.role,
    timezone: dto.timezone,
    locale: dto.locale,
    baseCurrency: dto.baseCurrency,
    status: dto.status,
    metadata: dto.metadata as Prisma.InputJsonValue | undefined,
  };
}
