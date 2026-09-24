import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MONTH_KEY_PATTERN } from '../../../common/finance/financial-period-policy';

const MONTH_MESSAGE =
  'month must be a month in YYYY-MM format, from 1900-01 to 2099-12';

export class DashboardMonthQueryDto {
  /** User month (DASH-002); defaults to the month containing now. */
  @IsOptional()
  @Matches(MONTH_KEY_PATTERN, { message: MONTH_MESSAGE })
  month?: string;
}

export class DashboardCashflowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;

  /** Last month of the trend; defaults to the month containing now. */
  @IsOptional()
  @Matches(MONTH_KEY_PATTERN, { message: MONTH_MESSAGE })
  month?: string;
}
