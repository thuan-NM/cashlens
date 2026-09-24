import { AlertType, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  ValidateIf,
} from 'class-validator';

export class UpdateAlertSettingDto {
  @IsEnum(AlertType)
  type!: AlertType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  emailEnabled?: boolean;

  /**
   * The LARGE_TRANSACTION amount in the base currency; greater than 0. null
   * clears it (the VND default of 5,000,000 applies again).
   */
  @ValidateIf((dto: UpdateAlertSettingDto) => dto.threshold !== null)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  threshold?: number | null;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
