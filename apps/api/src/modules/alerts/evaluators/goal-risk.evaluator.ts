import type { GoalStatus } from '@prisma/client';
import type { CompletedMonthCashflow } from '../../../common/finance/completed-month-cashflow';
import {
  PeriodSettings,
  normalizeCurrency,
  userMonthForKey,
} from '../../../common/finance/financial-period-policy';
import {
  FeasibilityGoal,
  computeFeasibility,
} from '../../goals/goal-feasibility';
import type { AlertCondition, AlertWindow } from './alert-condition';
import { KEY_PREFIX, goalKey, idOfKey } from './condition-keys';

/**
 * Goal-risk row of ALERT-009 (GOAL-002–GOAL-004). Pure. It applies the pure
 * `computeFeasibility` to the goal's STORED horizon (TARGET_DATE, then
 * GOAL_MONTHS, then DEFAULT; never the QUERY what-if), so its numbers are
 * the Goals page's default view.
 *
 * - Holds for an ACTIVE goal with a remaining amount when the required
 *   monthly saving exceeds the available monthly cashflow (a level other
 *   than SAFE). Insufficient history never holds.
 * - A goal that is not ACTIVE, or is gone, resolves (TARGET_REMOVED).
 */

export type GoalEvaluationGoal = FeasibilityGoal & {
  id: string;
  name: string;
  status: GoalStatus;
  /** Completed-month cashflow in the goal's currency. */
  observation: CompletedMonthCashflow;
};

/** The span of the observation months; null when there are none. */
export const observationWindowOf = (
  months: { key: string }[],
  settings: PeriodSettings,
): AlertWindow | null =>
  months.length
    ? {
        start: userMonthForKey(months[0].key, settings).from,
        end: userMonthForKey(months[months.length - 1].key, settings).to,
      }
    : null;

export function evaluateGoalRisk(input: {
  now: Date;
  settings: PeriodSettings;
  /** The user's non-deleted goals. */
  goals: GoalEvaluationGoal[];
  /** Currently open `goal:` keys of the user. */
  openKeys: string[];
}): AlertCondition[] {
  const conditions = input.goals.map((goal): AlertCondition => {
    const target = { resourceType: 'goal', resourceId: goal.id };
    if (goal.status !== 'ACTIVE') {
      return removed(goalKey(goal.id), target.resourceId);
    }
    const result = computeFeasibility({
      goal,
      now: input.now,
      observation: goal.observation,
      userMonthPolicy: input.settings,
    });
    const insufficient = result.status === 'INSUFFICIENT_DATA';
    const available = result.availableMonthlyCashflow;
    const holds =
      !insufficient &&
      available !== null &&
      result.remainingAmount.gt(0) &&
      result.monthlyRequired.gt(available);
    const currency = normalizeCurrency(goal.currency);
    return {
      key: goalKey(goal.id),
      holds,
      type: 'GOAL_RISK',
      severity: 'WARNING',
      target,
      threshold: available,
      observed: result.monthlyRequired,
      window: observationWindowOf(goal.observation.months, input.settings),
      mayCreate: true,
      resolutionReason: insufficient
        ? 'INSUFFICIENT_DATA'
        : result.remainingAmount.isZero()
          ? 'CONDITION_CLEARED'
          : 'BELOW_THRESHOLD',
      title: `Goal "${goal.name}" is at risk`,
      message: `Reaching this goal needs ${result.monthlyRequired.toString()} ${currency} a month, above the average available cashflow of ${available?.toString() ?? '-'} ${currency}.`,
      metadata: {
        goalId: goal.id,
        currency,
        remainingAmount: result.remainingAmount.toString(),
        monthlyRequired: result.monthlyRequired.toString(),
        availableMonthlyCashflow: available?.toString() ?? null,
        feasibilityScore: result.feasibilityScore,
        feasibilityStatus: result.status,
        months: result.months,
        horizonSource: result.horizonSource,
        pastDeadline: result.pastDeadline,
        observationMonths: result.observationMonths.join(','),
      },
    };
  });

  const produced = new Set(conditions.map((condition) => condition.key));
  for (const key of input.openKeys) {
    const id = idOfKey(key, KEY_PREFIX.goal);
    if (id && !produced.has(key)) conditions.push(removed(key, id));
  }
  return conditions;
}

const removed = (key: string, goalId: string): AlertCondition => ({
  key,
  holds: false,
  type: 'GOAL_RISK',
  severity: 'WARNING',
  target: { resourceType: 'goal', resourceId: goalId },
  threshold: null,
  observed: null,
  window: null,
  mayCreate: false,
  resolutionReason: 'TARGET_REMOVED',
  title: '',
  message: '',
  metadata: {},
});
