import { Prisma } from '@prisma/client';
import type { CompletedMonthCashflow } from '../../../common/finance/completed-month-cashflow';
import {
  PeriodSettings,
  normalizeCurrency,
} from '../../../common/finance/financial-period-policy';
import { computeFeasibility } from '../../goals/goal-feasibility';
import type { AlertCondition } from './alert-condition';
import { cashflowKey } from './condition-keys';
import { observationWindowOf } from './goal-risk.evaluator';

/**
 * Cashflow-risk row of ALERT-009 (GOAL-003). Pure. The projected next-month
 * net is the available monthly cashflow of GOAL-003 applied to the user's
 * base currency: the floor of the mean net of up to three completed months,
 * minimum two. Goal commitments are not subtracted (research.md "Defaults
 * pending confirmation").
 *
 * The number comes from `computeFeasibility` itself (its step 7) with an
 * empty goal in the base currency, so the rounding cannot drift from the
 * goals simulation.
 */
export function evaluateCashflowRisk(input: {
  now: Date;
  settings: PeriodSettings;
  userId: string;
  baseCurrency: string;
  /** Completed-month cashflow in the base currency. */
  observation: CompletedMonthCashflow;
}): AlertCondition[] {
  const currency = normalizeCurrency(input.baseCurrency);
  const result = computeFeasibility({
    goal: {
      targetAmount: new Prisma.Decimal(0),
      savedAmount: new Prisma.Decimal(0),
      currency,
      targetDate: null,
      months: null,
      createdAt: input.now,
    },
    now: input.now,
    observation: input.observation,
    userMonthPolicy: input.settings,
  });
  const available = result.availableMonthlyCashflow;
  const insufficient = available === null;
  const zero = new Prisma.Decimal(0);

  return [
    {
      key: cashflowKey(input.userId),
      holds: !insufficient && available.lt(zero),
      type: 'CASHFLOW_RISK',
      severity: 'CRITICAL',
      target: { resourceType: 'user', resourceId: input.userId },
      threshold: zero,
      observed: available,
      window: observationWindowOf(input.observation.months, input.settings),
      mayCreate: true,
      resolutionReason: insufficient ? 'INSUFFICIENT_DATA' : 'BELOW_THRESHOLD',
      title: 'Projected cashflow is negative',
      message: `Your average monthly net cashflow over the last completed months is ${available?.toString() ?? '-'} ${currency}, so next month is projected to be negative.`,
      metadata: {
        currency,
        projectedNet: available?.toString() ?? null,
        observationMonths: result.observationMonths.join(','),
      },
    },
  ];
}
