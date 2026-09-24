import { BudgetPeriod, Prisma } from '@prisma/client';
import { monthlyInstanceAt } from '../../../common/finance/budget-spend.query';
import {
  PeriodSettings,
  normalizeCurrency,
} from '../../../common/finance/financial-period-policy';
import {
  CRITICAL_THRESHOLD_PERCENT,
  budgetThresholdState,
} from '../../../common/finance/budget-threshold.policy';
import type { AlertCondition, AlertResolutionReason } from './alert-condition';
import {
  BudgetSeverityTier,
  budgetKey,
  parseBudgetKey,
} from './condition-keys';

/**
 * Budget threshold rows of ALERT-009 (BUDGET-002, BUDGET-003, BUDGET-005).
 * Pure: `spent` is the budget's eligible spend in its current MONTHLY
 * instance, from the shared spend aggregate.
 *
 * - Only MONTHLY budgets are evaluated; each has an independent WARNING
 *   (absent for a legacy threshold of 100 or more) and CRITICAL condition,
 *   keyed by the instance's local start date.
 * - Only the instance containing `now` can open an occurrence. An open key
 *   of any other instance resolves (PERIOD_ENDED), as does one of a budget
 *   that is gone or no longer MONTHLY (TARGET_REMOVED).
 */

export type BudgetEvaluationBudget = {
  id: string;
  name: string;
  period: BudgetPeriod;
  categoryId: string | null;
  currency: string;
  amount: Prisma.Decimal;
  thresholdPercent: number;
  startsAt: Date;
  endsAt: Date | null;
  spent: Prisma.Decimal;
};

const TIER_LABEL: Record<BudgetSeverityTier, string> = {
  WARNING: 'warning threshold',
  CRITICAL: 'limit',
};

/** A decimal as plain text, trailing zeros dropped. */
const plain = (value: Prisma.Decimal) => value.toDecimalPlaces(4).toString();

export function evaluateBudgetThresholds(input: {
  now: Date;
  settings: PeriodSettings;
  /** Active, non-archived budgets; any other budget is gone. */
  budgets: BudgetEvaluationBudget[];
  /** Currently open `budget:` keys of the user. */
  openKeys: string[];
}): AlertCondition[] {
  const conditions: AlertCondition[] = [];
  const byId = new Map(input.budgets.map((budget) => [budget.id, budget]));

  for (const budget of input.budgets) {
    const result = monthlyInstanceAt(budget, input.now, input.settings);
    if (!result.supported || !result.instance) continue;
    const { instance } = result;
    const state = budgetThresholdState({
      thresholdPercent: budget.thresholdPercent,
      amount: budget.amount,
      spent: budget.spent,
    });
    const currency = normalizeCurrency(budget.currency);
    const percentUsed = state.percentUsed ?? new Prisma.Decimal(0);
    const tiers: [BudgetSeverityTier, number, boolean][] = [
      ...(state.warningThresholdActive
        ? [
            ['WARNING', budget.thresholdPercent, state.warning] as [
              BudgetSeverityTier,
              number,
              boolean,
            ],
          ]
        : []),
      ['CRITICAL', CRITICAL_THRESHOLD_PERCENT, state.critical],
    ];
    for (const [tier, threshold, holds] of tiers) {
      conditions.push({
        key: budgetKey(budget.id, instance.key, tier),
        holds,
        type: 'BUDGET_THRESHOLD',
        severity: tier,
        target: { resourceType: 'budget', resourceId: budget.id },
        threshold: new Prisma.Decimal(threshold),
        observed: percentUsed.toDecimalPlaces(4),
        window: { start: instance.usage.from, end: instance.usage.to },
        mayCreate: true,
        resolutionReason: 'BELOW_THRESHOLD',
        title:
          tier === 'CRITICAL'
            ? `Budget "${budget.name}" reached its limit`
            : `Budget "${budget.name}" reached its warning threshold`,
        message: `Spending is ${plain(percentUsed)}% of the ${plain(budget.amount)} ${currency} budget for the period starting ${instance.key} (${TIER_LABEL[tier]}: ${threshold}%).`,
        metadata: {
          budgetId: budget.id,
          categoryId: budget.categoryId,
          currency,
          amount: plain(budget.amount),
          spent: plain(budget.spent),
          percentUsed: plain(percentUsed),
          thresholdPercent: threshold,
          periodStartDate: instance.key,
        },
      });
    }
  }

  // Open keys this evaluation did not produce: another instance, a warning
  // that no longer exists, or a budget that is gone.
  const produced = new Set(conditions.map((condition) => condition.key));
  for (const key of input.openKeys) {
    if (produced.has(key)) continue;
    const parsed = parseBudgetKey(key);
    if (!parsed) continue;
    const budget = byId.get(parsed.budgetId);
    let reason: AlertResolutionReason;
    if (!budget || budget.period !== 'MONTHLY') {
      reason = 'TARGET_REMOVED';
    } else {
      const current = monthlyInstanceAt(budget, input.now, input.settings);
      reason =
        current.supported &&
        current.instance &&
        current.instance.key === parsed.instanceStartDate
          ? 'BELOW_THRESHOLD' // the warning tier no longer exists
          : 'PERIOD_ENDED';
    }
    conditions.push(
      staleBudgetCondition(key, parsed.budgetId, parsed.tier, reason),
    );
  }
  return conditions;
}

const staleBudgetCondition = (
  key: string,
  budgetId: string,
  tier: BudgetSeverityTier,
  reason: AlertResolutionReason,
): AlertCondition => ({
  key,
  holds: false,
  type: 'BUDGET_THRESHOLD',
  severity: tier,
  target: { resourceType: 'budget', resourceId: budgetId },
  threshold: null,
  observed: null,
  window: null,
  mayCreate: false,
  resolutionReason: reason,
  title: '',
  message: '',
  metadata: {},
});
