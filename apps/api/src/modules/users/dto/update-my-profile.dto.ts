import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Self-service profile update (PATCH /users/me). Role, status, email,
 * ownership, and metadata are not part of it, so the global ValidationPipe
 * rejects them with 400 (SEC-003, SEC-004).
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  baseCurrency?: string;
}
