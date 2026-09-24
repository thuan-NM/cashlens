import {
  TransactionDirection,
  TransactionSourceType,
  TransactionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { IsInstant } from '../../../common/finance/finance-validation';
import { MONTH_KEY_PATTERN } from '../../../common/finance/financial-period-policy';

export class ListTransactionsDto {
  /** User month (DASH-002); cannot be combined with from/to. */
  @IsOptional()
  @Matches(MONTH_KEY_PATTERN, {
    message: 'month must be a month in YYYY-MM format, from 1900-01 to 2099-12',
  })
  month?: string;

  /** Inclusive lower bound; must not be after `to`. */
  @IsOptional()
  @IsInstant()
  from?: string;

  /** Inclusive upper bound. */
  @IsOptional()
  @IsInstant()
  to?: string;

  @IsOptional()
  @IsString()
  financialAccountId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsEnum(TransactionSourceType)
  sourceType?: TransactionSourceType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
