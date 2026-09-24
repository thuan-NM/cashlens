import {
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import {
  PeriodSettings,
  isEligibleTransaction,
  isInRange,
  normalizeCurrency,
  userMonthContaining,
} from '../../../common/finance/financial-period-policy';
import type { AlertCondition } from './alert-condition';
import { largeTransactionKey } from './condition-keys';

/**
 * Large-transaction row of ALERT-009. Pure. Only the transactions the
 * trigger changed are evaluated (a create, or an update of amount, currency,
 * direction, or eligibility), so a threshold change never re-evaluates
 * existing transactions.
 *
 * - One eligible EXPENSE in the base currency at or above the threshold;
 *   transfers and other directions never count.
 * - The threshold is the user's LARGE_TRANSACTION setting in the base
 *   currency; without one it is 5,000,000 for VND and inactive otherwise.
 * - An occurrence opens only for a transaction dated in the current user
 *   month; it resolves when the transaction is deleted, ignored, marked
 *   duplicate, made non-expense, or its amount drops below the threshold.
 */

export const LARGE_TRANSACTION_VND_DEFAULT = new Prisma.Decimal(5_000_000);

export type LargeTransactionRow = {
  amount: Prisma.Decimal;
  currency: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  isDuplicate: boolean;
  transactionTime: Date;
};

const plain = (value: Prisma.Decimal) => value.toString();

export function evaluateLargeTransactions(input: {
  now: Date;
  settings: PeriodSettings;
  baseCurrency: string;
  /** The user's LARGE_TRANSACTION threshold; null when unset. */
  threshold: Prisma.Decimal | null;
  /** The changed transactions; `row` is null when it no longer exists. */
  transactions: { id: string; row: LargeTransactionRow | null }[];
}): AlertCondition[] {
  const base = normalizeCurrency(input.baseCurrency);
  const threshold =
    input.threshold ?? (base === 'VND' ? LARGE_TRANSACTION_VND_DEFAULT : null);
  const currentMonth = userMonthContaining(input.now, input.settings);

  return input.transactions.map(({ id, row }): AlertCondition => {
    const eligible = row !== null && isEligibleTransaction(row);
    const qualifies =
      eligible &&
      row.direction === TransactionDirection.EXPENSE &&
      normalizeCurrency(row.currency) === base;
    const holds = qualifies && threshold !== null && row.amount.gte(threshold);
    return {
      key: largeTransactionKey(id),
      holds,
      type: 'LARGE_TRANSACTION',
      severity: 'WARNING',
      target: { resourceType: 'transaction', resourceId: id },
      threshold,
      observed: row ? row.amount : null,
      window: row
        ? { start: row.transactionTime, end: row.transactionTime }
        : null,
      mayCreate: row !== null && isInRange(row.transactionTime, currentMonth),
      resolutionReason: !eligible
        ? 'TARGET_REMOVED'
        : qualifies
          ? 'BELOW_THRESHOLD'
          : 'CONDITION_CLEARED', // no longer a base-currency expense
      title: 'Large transaction',
      message: row
        ? `An expense of ${plain(row.amount)} ${base} is at or above your large-transaction threshold of ${threshold ? plain(threshold) : '-'} ${base}.`
        : '',
      metadata: row
        ? {
            transactionId: id,
            amount: plain(row.amount),
            currency: normalizeCurrency(row.currency),
            threshold: threshold ? plain(threshold) : null,
          }
        : { transactionId: id },
    };
  });
}
