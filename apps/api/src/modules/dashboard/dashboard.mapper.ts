import {
  PeriodSettings,
  UserMonth,
  userMonthContaining,
  userMonthForKey,
} from '../../common/finance/financial-period-policy';

/** The requested user month, or the one containing now (DASH-002). */
export const dashboardMonth = (
  settings: PeriodSettings,
  month?: string,
  now = new Date(),
): UserMonth =>
  month ? userMonthForKey(month, settings) : userMonthContaining(now, settings);

export const formatAmount = (amount: number, currency: string) =>
  `${amount.toLocaleString('vi-VN')} ${currency}`;
