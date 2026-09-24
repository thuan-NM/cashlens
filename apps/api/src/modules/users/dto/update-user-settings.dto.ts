import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateUserSettingsDto {
  /**
   * DATA-001: only `false` is accepted; `true` is refused by the service
   * with 400 RAW_EMAIL_BODY_UNAVAILABLE. Raw bodies are never retained.
   */
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
