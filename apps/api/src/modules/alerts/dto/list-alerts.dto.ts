import { AlertSeverity, AlertStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Query booleans arrive as text: only "true" and "false" are booleans, and
 * anything else stays as sent so validation rejects it. (A plain
 * `@Type(() => Boolean)` would read "false" as true.)
 */
const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

export class ListAlertsDto {
  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  /** Lifecycle status filter (ALERT-004). */
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  /** Read-state filter; the contract name. */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  isRead?: boolean;

  /** Read-state filter; the existing name, kept for current clients. */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  read?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
