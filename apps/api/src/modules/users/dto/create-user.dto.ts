import { UserRole, UserStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsTimeZone,
} from 'class-validator';
import { IsCurrencyCode } from '../../../common/finance/finance-validation';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsCurrencyCode()
  baseCurrency?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
