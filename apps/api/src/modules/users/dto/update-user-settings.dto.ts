import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateUserSettingsDto {
  @IsOptional()
  @IsBoolean()
  storeRawEmailBody?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAiInsights?: boolean;

  @IsOptional()
  @IsBoolean()
  autoClassificationEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  defaultMonthStartDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dataRetentionDays?: number;

  @IsOptional()
  @IsBoolean()
  notificationEnabled?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
