import { Prisma } from '@prisma/client';
import type { Goal } from '@prisma/client';
import type { CompletedMonthCashflow } from '../../common/finance/completed-month-cashflow';
import {
  PeriodSettings,
  localDateKey,
  normalizeCurrency,
  userMonthContaining,
} from '../../common/finance/financial-period-policy';

/**
 * Goal feasibility (GOAL-002–GOAL-005), exactly the data-model "Goal
 * calculations" steps. Pure: no provider, no clock, no database, so the
 * goal-risk alert can apply it to a goal's stored horizon (T073).
 *
 * - Months are user months (the shared period policy); both the current and
 *   the deadline month count, and a deadline before the current month leaves
 *   0 periods.
 * - Required saving rounds up to the currency unit, available cashflow and
 *   the score round down. The unit is 1 for VND and 0.01 otherwise. Nothing
 *   else is rounded, and all arithmetic is exact decimal.
 * - Fewer than two observed completed months is INSUFFICIENT_DATA: no score,
 *   no available cashflow, and no assumed value in their place.
 */

export type HorizonSource = 'QUERY' | 'TARGET_DATE' | 'GOAL_MONTHS' | 'DEFAULT';
export type FeasibilityStatus =
  | 'SAFE'
  | 'ACCEPTABLE'
  | 'RISKY'
  | 'NOT_RECOMMENDED'
  | 'INSUFFICIENT_DATA';
/**
 * Reason codes, reported comma-separated in this order. The outcome code
 * COMPLETED_MONTHS_AVERAGE stands alone when no other code applies.
 */
export type FeasibilityReason =
  | 'INSUFFICIENT_HISTORY'
  | 'TARGET_REACHED'
  | 'PAST_DEADLINE'
  | 'COMPLETED_MONTHS_AVERAGE';

export type FeasibilityGoal = Pick<
  Goal,
  | 'targetAmount'
  | 'savedAmount'
  | 'currency'
  | 'targetDate'
  | 'months'
  | 'createdAt'
>;

export type Feasibility = {
  remainingAmount: Prisma.Decimal;
  /** Remaining periods: the divisor of the required saving. */
  months: number;
  horizonSource: HorizonSource;
  pastDeadline: boolean;
  monthlyRequired: Prisma.Decimal;
  availableMonthlyCashflow: Prisma.Decimal | null;
  feasibilityScore: number | null;
  status: FeasibilityStatus;
  observationMonths: string[];
  monthsRequired: number;
  reason: string;
};

/** Minimum observed completed months (GOAL-003, GOAL-005). */
export const MIN_OBSERVATION_MONTHS = 2;
/** The visible default horizon: the current month plus 5 (GOAL-002). */
export const DEFAULT_HORIZON_MONTHS = 6;

// Enough precision that division never rounds before the named steps: the
// largest Decimal(18,2) amount divided by any period count stays exact to far
// below one unit.
const Exact = Prisma.Decimal.clone({ precision: 64 });
type Exact = InstanceType<typeof Exact>;

const exact = (value: Prisma.Decimal.Value) => new Exact(value.toString());
const toPrisma = (value: Exact) => new Prisma.Decimal(value.toFixed());

/** Decimal places of the currency unit: 1 for VND, 0.01 for others. */
const unitPlaces = (currency: string) =>
  normalizeCurrency(currency) === 'VND' ? 0 : 2;

const indexOfKey = (key: string) =>
  Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;

/**
 * Index (year × 12 + month) of the user month containing an instant. Inside
 * the supported calendar (1900–2099) this is the shared policy's month;
 * beyond it the calendar rule alone applies: the local date's month, or the
 * month before when the local day precedes the month-start day.
 */
const userMonthIndex = (instant: Date, settings: PeriodSettings): number => {
  try {
    return indexOfKey(userMonthContaining(instant, settings).key);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const match = /^(-?\d+)-(\d{2})-(\d{2})$/.exec(
      localDateKey(instant, settings.timeZone),
    );
    if (!match) throw error;
    const [year, month, day] = match.slice(1).map(Number);
    return year * 12 + month - 1 - (day < settings.monthStartDay ? 1 : 0);
  }
};

const levelOf = (score: number): FeasibilityStatus =>
  score >= 100
    ? 'SAFE'
    : score >= 80
      ? 'ACCEPTABLE'
      : score >= 50
        ? 'RISKY'
        : 'NOT_RECOMMENDED';

export function computeFeasibility(input: {
  goal: FeasibilityGoal;
  now: Date;
  /** The what-if horizon of the request (`QUERY`); absent for the stored one. */
  queryMonths?: number;
  observation: CompletedMonthCashflow;
  userMonthPolicy: PeriodSettings;
}): Feasibility {
  const { goal, now, queryMonths, observation } = input;
  const settings = input.userMonthPolicy;
  const places = unitPlaces(goal.currency);

  // 1. Remaining amount.
  const remaining = Exact.max(
    0,
    exact(goal.targetAmount).minus(exact(goal.savedAmount)),
  );

  // 2. Deadline month and its source, in order of precedence.
  const current = userMonthIndex(now, settings);
  let horizonSource: HorizonSource;
  let deadline: number;
  if (queryMonths !== undefined && queryMonths !== null) {
    horizonSource = 'QUERY';
    deadline = current + queryMonths - 1;
  } else if (goal.targetDate) {
    horizonSource = 'TARGET_DATE';
    deadline = userMonthIndex(goal.targetDate, settings);
  } else if (goal.months !== null && goal.months !== undefined) {
    horizonSource = 'GOAL_MONTHS';
    deadline = userMonthIndex(goal.createdAt, settings) + goal.months - 1;
  } else {
    horizonSource = 'DEFAULT';
    deadline = current + DEFAULT_HORIZON_MONTHS - 1;
  }

  // 3. Remaining periods, current and deadline month included. The result is
  // past deadline only while an amount remains (GOAL-002, contract).
  const months = Math.max(0, deadline - current + 1);
  const pastDeadline = months === 0 && !remaining.isZero();

  // 4. Required monthly saving: the whole remaining amount when no period is
  // left, otherwise rounded up to the unit.
  const monthlyRequired = remaining.isZero()
    ? exact(0)
    : months === 0
      ? remaining
      : remaining.div(months).toDecimalPlaces(places, Exact.ROUND_CEIL);

  // 5. Observation months (completed, from the history start, at most 3).
  const observationMonths = observation.months.map((month) => month.key);
  const count = observation.months.length;

  const reasons: FeasibilityReason[] = [];
  if (count < MIN_OBSERVATION_MONTHS) reasons.push('INSUFFICIENT_HISTORY');
  if (remaining.isZero()) reasons.push('TARGET_REACHED');
  if (pastDeadline) reasons.push('PAST_DEADLINE');
  if (!reasons.length) reasons.push('COMPLETED_MONTHS_AVERAGE');

  const base = {
    remainingAmount: toPrisma(remaining),
    months,
    horizonSource,
    pastDeadline,
    monthlyRequired: toPrisma(monthlyRequired),
    observationMonths,
    reason: reasons.join(', '),
  };

  // 6. Insufficient history: no score and no available cashflow.
  if (count < MIN_OBSERVATION_MONTHS) {
    return {
      ...base,
      availableMonthlyCashflow: null,
      feasibilityScore: null,
      status: 'INSUFFICIENT_DATA',
      monthsRequired: MIN_OBSERVATION_MONTHS - count,
    };
  }

  // 7. Available cashflow: the mean net, rounded down (toward -infinity).
  const available = observation.months
    .reduce((sum, month) => sum.plus(exact(month.net)), exact(0))
    .div(count)
    .toDecimalPlaces(places, Exact.ROUND_FLOOR);

  // 8. Score, rounded down and capped to 0–100; 100 when nothing is required.
  const feasibilityScore = monthlyRequired.isZero()
    ? 100
    : Math.min(
        100,
        Math.max(
          0,
          available.times(100).div(monthlyRequired).floor().toNumber(),
        ),
      );

  // 9. Level.
  return {
    ...base,
    availableMonthlyCashflow: toPrisma(available),
    feasibilityScore,
    status: levelOf(feasibilityScore),
    monthsRequired: 0,
  };
}
