import { Budget, Prisma, TransactionCategory } from '@prisma/client';
import type { TimeRange } from '../../common/finance/financial-period-policy';
import {
  CRITICAL_THRESHOLD_PERCENT,
  budgetThresholdState,
  isWarningThresholdActive,
} from './budget-threshold.policy';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

export type BudgetWithCategory = Budget & {
  category: TransactionCategory | null;
};

/**
 * MONTHLY budgets report the user-month period instance (BUDGET-002); the
 * other periods keep the calendar-month projection (BUDGET-005).
 */
export type UsageBasis = 'PERIOD_INSTANCE' | 'CALENDAR_MONTH_APPROXIMATION';

export interface BudgetUsage {
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverLimit: boolean;
  isNearThreshold: boolean;
  /** The counted range; null when a MONTHLY budget has no instance then. */
  periodStart: string | null;
  periodEnd: string | null;
}

/** How the usage was computed: its basis and its counted range. */
export type BudgetUsageContext = {
  basis: UsageBasis;
  range: TimeRange | null;
};

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? 0 : Number(value.toString());

const optionalDateToIso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Read-time projection: `isNearThreshold` is the shared threshold rule
 * (BUDGET-004); nothing here creates or resolves alerts.
 */
export const toBudgetUsage = (
  budget: Budget,
  spent: Prisma.Decimal.Value,
  range: TimeRange | null = null,
): BudgetUsage => {
  const amount = new Prisma.Decimal(budget.amount);
  const spentDecimal = new Prisma.Decimal(spent);
  const state = budgetThresholdState({
    thresholdPercent: budget.thresholdPercent,
    amount,
    spent: spentDecimal,
  });
  const remaining = amount.minus(spentDecimal);

  return {
    spent: spentDecimal.toNumber(),
    remaining: remaining.isNegative() ? 0 : remaining.toNumber(),
    percentUsed: state.percentUsed
      ? state.percentUsed
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : 0,
    isOverLimit: spentDecimal.gt(amount),
    isNearThreshold: state.isNearThreshold,
    periodStart: range ? range.from.toISOString() : null,
    periodEnd: range ? range.to.toISOString() : null,
  };
};

export const toBudgetResponse = (
  budget: BudgetWithCategory,
  spent: Prisma.Decimal.Value = 0,
  context: BudgetUsageContext = {
    basis:
      budget.period === 'MONTHLY'
        ? 'PERIOD_INSTANCE'
        : 'CALENDAR_MONTH_APPROXIMATION',
    range: null,
  },
) => ({
  id: budget.id,
  userId: budget.userId,
  categoryId: budget.categoryId,
  name: budget.name,
  amount: decimalToNumber(budget.amount),
  currency: budget.currency,
  period: budget.period,
  startsAt: budget.startsAt.toISOString(),
  endsAt: optionalDateToIso(budget.endsAt),
  thresholdPercent: budget.thresholdPercent,
  warningThresholdActive: isWarningThresholdActive(budget.thresholdPercent),
  criticalThresholdPercent: CRITICAL_THRESHOLD_PERCENT,
  alertsSupported: budget.period === 'MONTHLY',
  usageBasis: context.basis,
  rollover: budget.rollover,
  isActive: budget.isActive,
  category: budget.category,
  usage: toBudgetUsage(budget, spent, context.range),
  createdAt: budget.createdAt.toISOString(),
  updatedAt: budget.updatedAt.toISOString(),
});

export const toCreateBudgetInput = (
  userId: string,
  dto: CreateBudgetDto,
): Prisma.BudgetUncheckedCreateInput => ({
  userId,
  categoryId: dto.categoryId,
  name: dto.name,
  amount: dto.amount,
  currency: dto.currency,
  period: dto.period,
  startsAt: new Date(dto.startsAt),
  endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
  thresholdPercent: dto.thresholdPercent,
  rollover: dto.rollover,
  isActive: dto.isActive,
});

export const toUpdateBudgetInput = (
  dto: UpdateBudgetDto,
): Prisma.BudgetUncheckedUpdateInput => ({
  categoryId: dto.categoryId,
  name: dto.name,
  amount: dto.amount,
  currency: dto.currency,
  period: dto.period,
  startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
  endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
  thresholdPercent: dto.thresholdPercent,
  rollover: dto.rollover,
  isActive: dto.isActive,
});
