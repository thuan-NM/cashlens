import { IsOptional, Matches } from 'class-validator';
import { IsInstant } from '../../../common/finance/finance-validation';
import { MONTH_KEY_PATTERN } from '../../../common/finance/financial-period-policy';

export class MonthlyAnalyticsQueryDto {
  /** User month (DASH-002); defaults to the month containing now. */
  @IsOptional()
  @Matches(MONTH_KEY_PATTERN, {
    message: 'month must be a month in YYYY-MM format, from 1900-01 to 2099-12',
  })
  month?: string;
}

/** Half-open [from, to) instants; each defaults to the current user month's bound. */
export class RangeAnalyticsQueryDto {
  @IsOptional()
  @IsInstant()
  from?: string;

  @IsOptional()
  @IsInstant()
  to?: string;
}
