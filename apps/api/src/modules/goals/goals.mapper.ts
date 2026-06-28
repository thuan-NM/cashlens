import { Goal, GoalScenarioType, Prisma } from '@prisma/client';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? 0 : Number(value.toString());

const optionalDateToIso = (value: Date | null) => value?.toISOString() ?? null;

export const toGoalResponse = (goal: Goal) => {
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
    remainingAmount: Math.max(0, targetAmount - savedAmount),
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
  targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
  months: dto.months,
  priority: dto.priority,
  status: dto.status,
  metadata: dto.metadata,
});

export const simulateGoal = (
  goal: Goal,
  months: number,
  scenario: GoalScenarioType,
) => {
  const targetAmount = decimalToNumber(goal.targetAmount);
  const savedAmount = decimalToNumber(goal.savedAmount);
  const remainingAmount = Math.max(0, targetAmount - savedAmount);
  const scenarioMultiplier =
    scenario === GoalScenarioType.INSTALLMENT ? 1.099 : 1;
  const totalCost = remainingAmount * scenarioMultiplier;
  const monthlyRequired = months <= 0 ? totalCost : totalCost / months;
  const assumedFreeCashflow = 3900000;
  const feasibilityScore =
    monthlyRequired === 0
      ? 100
      : Math.min(
          100,
          Math.round((assumedFreeCashflow / monthlyRequired) * 100),
        );

  return {
    goalId: goal.id,
    scenario,
    months,
    targetAmount,
    savedAmount,
    remainingAmount,
    totalCost: Math.round(totalCost),
    monthlyRequired: Math.round(monthlyRequired),
    feasibilityScore,
    status:
      feasibilityScore >= 100
        ? 'SAFE'
        : feasibilityScore >= 70
          ? 'WATCH'
          : 'RISK',
  };
};
