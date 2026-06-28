import { AlertSeverity, AlertType, Prisma } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAlertDto {
  @IsEnum(AlertType)
  type!: AlertType;

  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @IsString()
  @MaxLength(180)
  title!: string;

  @IsString()
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
