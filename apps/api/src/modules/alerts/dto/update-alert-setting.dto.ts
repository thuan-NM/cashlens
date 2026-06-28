import { AlertType, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  threshold?: number;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
