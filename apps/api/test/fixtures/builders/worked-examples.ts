import type { LedgerRow } from './ledger';

/**
 * The data-model "Goal calculations" worked-example histories (T098), shared
 * by the goal (US6) and alert (US5) suites. The example clock is
 * 2026-09-23T10:00+07:00 (Asia/Ho_Chi_Minh, month-start day 1), so the
 * completed months are 2026-06, 2026-07, and 2026-08.
 */
export const WORKED_EXAMPLE_NOW = new Date('2026-09-23T10:00:00+07:00');

/** H1: nets Jun 9,000,000; Jul 8,000,000; Aug 10,000,001 → available 9,000,000. */
export const H1: LedgerRow[] = [
  { time: '2025-01-10T08:00:00+07:00', direction: 'EXPENSE', amount: 50_000 },
  { time: '2026-06-05T08:00:00+07:00', direction: 'INCOME', amount: 9_000_000 },
  {
    time: '2026-07-05T08:00:00+07:00',
    direction: 'INCOME',
    amount: 10_000_000,
  },
  {
    time: '2026-07-20T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 2_000_000,
  },
  {
    time: '2026-08-05T08:00:00+07:00',
    direction: 'INCOME',
    amount: 12_000_001,
  },
  {
    time: '2026-08-20T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 2_000_000,
  },
];

/** G6: nets Jun −2,000,000; Jul −1,000,000; Aug −1,500,001 → available −1,500,001. */
export const G6: LedgerRow[] = [
  {
    time: '2026-06-10T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 2_000_000,
  },
  {
    time: '2026-07-10T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 1_000_000,
  },
  {
    time: '2026-08-10T08:00:00+07:00',
    direction: 'EXPENSE',
    amount: 1_500_001,
  },
];
