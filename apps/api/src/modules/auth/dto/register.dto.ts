import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  IsTimeZone,
} from 'class-validator';
import { IsCurrencyCode } from '../../../common/finance/finance-validation';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

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
}
