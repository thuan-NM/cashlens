import { Goal, GoalScenarioType, Prisma } from '@prisma/client';
import { CreateGoalDto } from './dto/create-goal.dto';
import { GoalFeasibilityResponseDto } from './dto/goal-feasibility.response';
import { GoalResponseDto } from './dto/goal.response';
import { UpdateGoalDto } from './dto/update-goal.dto';
import type { Feasibility } from './goal-feasibility';

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? 0 : Number(value.toString());

/** A JSON number; never -0. */
const amount = (value: Prisma.Decimal) => {
  const number = value.toNumber();
  return number === 0 ? 0 : number;
};

/** GOAL-002 remaining amount, exact: the same value the simulation reports. */
const remainingOf = (goal: Pick<Goal, 'targetAmount' | 'savedAmount'>) =>
  Prisma.Decimal.max(0, goal.targetAmount.minus(goal.savedAmount));

const optionalDateToIso = (value: Date | null) => value?.toISOString() ?? null;

export const toGoalResponse = (goal: Goal): GoalResponseDto => {
  const targetAmount = decimalToNumber(goal.targetAmount);
  const savedAmount = decimalToNumber(goal.savedAmount);
  const progressPercent =
    targetAmount === 0
      ? 0
      : Math.min(100, Math.round((savedAmount / targetAmount) * 100));

  return {
    id: goal.id,
    userId: goal.userId,
    name: goal.name,
    type: goal.type,
    targetAmount,
    savedAmount,
    remainingAmount: amount(remainingOf(goal)),
    progressPercent,
    currency: goal.currency,
    targetDate: optionalDateToIso(goal.targetDate),
    months: goal.months,
    priority: goal.priority,
    status: goal.status,
    metadata: goal.metadata,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
};

export const toCreateGoalInput = (
  userId: string,
  dto: CreateGoalDto,
): Prisma.GoalUncheckedCreateInput => ({
  userId,
  name: dto.name,
  type: dto.type,
  targetAmount: dto.targetAmount,
  savedAmount: dto.savedAmount,
  currency: dto.currency,
  targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
  months: dto.months,
  priority: dto.priority,
  status: dto.status,
  metadata: dto.metadata,
});

export const toUpdateGoalInput = (
  dto: UpdateGoalDto,
): Prisma.GoalUncheckedUpdateInput => ({
  name: dto.name,
  type: dto.type,
  targetAmount: dto.targetAmount,
  savedAmount: dto.savedAmount,
  currency: dto.currency,
  // null clears the date, so the planned months or the default horizon apply again (GOAL-002).
  targetDate:
    dto.targetDate === null
      ? null
      : dto.targetDate
        ? new Date(dto.targetDate)
        : undefined,
  months: dto.months,
  priority: dto.priority,
  status: dto.status,
  metadata: dto.metadata,
});

/**
 * The GoalFeasibility contract (T061). Amounts become JSON numbers; nothing is
 * rounded here. INSTALLMENT is accepted but no rate or term is inferred
 * (GOAL-007): the whole remaining amount is the cost, and the reason says so.
 */
export const toGoalFeasibilityResponse = (
  goal: Goal,
  result: Feasibility,
  scenario: GoalScenarioType,
): GoalFeasibilityResponseDto => ({
  goalId: goal.id,
  scenario,
  months: result.months,
  horizonSource: result.horizonSource,
  pastDeadline: result.pastDeadline,
  targetAmount: decimalToNumber(goal.targetAmount),
  savedAmount: decimalToNumber(goal.savedAmount),
  remainingAmount: amount(result.remainingAmount),
  totalCost: amount(result.remainingAmount),
  monthlyRequired: amount(result.monthlyRequired),
  feasibilityScore: result.feasibilityScore,
  status: result.status,
  availableMonthlyCashflow:
    result.availableMonthlyCashflow === null
      ? null
      : amount(result.availableMonthlyCashflow),
  observationMonths: result.observationMonths,
  monthsRequired: result.monthsRequired,
  reason:
    scenario === GoalScenarioType.INSTALLMENT
      ? `${result.reason}, INSTALLMENT_WITHOUT_INTEREST`
      : result.reason,
});
