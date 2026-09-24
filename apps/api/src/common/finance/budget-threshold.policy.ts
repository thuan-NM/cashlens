import { Prisma } from '@prisma/client';

/**
 * The one budget threshold rule (BUDGET-001, BUDGET-004), shared by the
 * budget evaluator and every read-time projection: `usage.isNearThreshold`,
 * `GET /budgets/alerts`, and the dashboard's hot budgets. Pure.
 *
 * - The warning threshold is the stored `thresholdPercent` when it is 1–99.
 *   A legacy value of 100 or more (or anything outside 1–99) means no warning
 *   condition; critical is still evaluated.
 * - Critical is fixed at 100%.
 * - Usage % = spent × 100 ÷ amount, compared exactly: the boundary itself
 *   holds, and a value that merely rounds up to it does not.
 * - A zero amount has no usage percentage, so nothing holds.
 */

export const CRITICAL_THRESHOLD_PERCENT = 100;

export type BudgetThresholdState = {
  /** Exact usage percentage; null when the amount is not positive. */
  percentUsed: Prisma.Decimal | null;
  warningThresholdActive: boolean;
  warning: boolean;
  critical: boolean;
  /** Warning when active, otherwise critical (data-model "Budget thresholds"). */
  isNearThreshold: boolean;
};

export const isWarningThresholdActive = (thresholdPercent: number): boolean =>
  Number.isInteger(thresholdPercent) &&
  thresholdPercent >= 1 &&
  thresholdPercent < CRITICAL_THRESHOLD_PERCENT;

export const budgetThresholdState = (input: {
  thresholdPercent: number;
  amount: Prisma.Decimal.Value;
  spent: Prisma.Decimal.Value;
}): BudgetThresholdState => {
  const warningThresholdActive = isWarningThresholdActive(
    input.thresholdPercent,
  );
  const amount = new Prisma.Decimal(input.amount);
  if (!amount.isPositive() || amount.isZero()) {
    return {
      percentUsed: null,
      warningThresholdActive,
      warning: false,
      critical: false,
      isNearThreshold: false,
    };
  }
  const percentUsed = new Prisma.Decimal(input.spent).times(100).div(amount);
  const warning =
    warningThresholdActive && percentUsed.gte(input.thresholdPercent);
  const critical = percentUsed.gte(CRITICAL_THRESHOLD_PERCENT);
  return {
    percentUsed,
    warningThresholdActive,
    warning,
    critical,
    isNearThreshold: warningThresholdActive ? warning : critical,
  };
};
