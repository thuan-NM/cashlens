import {
  PeriodSettings,
  TimeRange,
  UserMonth,
  userMonthContaining,
  userMonthForKey,
} from '../../../common/finance/financial-period-policy';
import { RangeAnalyticsQueryDto } from '../dto/analytics-query.dto';

/** The requested user month, or the one containing now (DASH-002). */
export const analyticsMonth = (
  settings: PeriodSettings,
  month?: string,
  now = new Date(),
): UserMonth =>
  month ? userMonthForKey(month, settings) : userMonthContaining(now, settings);

/**
 * An explicit `[from, to)` instant range; a missing bound defaults to the
 * current user month's bound.
 */
export const analyticsRange = (
  query: RangeAnalyticsQueryDto,
  settings: PeriodSettings,
  now = new Date(),
): TimeRange => {
  const current = analyticsMonth(settings, undefined, now);
  return {
    from: query.from ? new Date(query.from) : current.from,
    to: query.to ? new Date(query.to) : current.to,
  };
};
