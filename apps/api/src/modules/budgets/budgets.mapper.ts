import { Budget, Prisma, TransactionCategory } from '@prisma/client';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

export type BudgetWithCategory = Budget & {
  category: TransactionCategory | null;
};

export interface BudgetUsage {
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverLimit: boolean;
  isNearThreshold: boolean;
}

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? 0 : Number(value.toString());

const optionalDateToIso = (value: Date | null) => value?.toISOString() ?? null;

export const toBudgetUsage = (budget: Budget, spent: number): BudgetUsage => {
  const amount = decimalToNumber(budget.amount);
  const percentUsed = amount === 0 ? 0 : Math.round((spent / amount) * 100);

  return {
    spent,
    remaining: Math.max(0, amount - spent),
    percentUsed,
    isOverLimit: spent > amount,
    isNearThreshold: percentUsed >= budget.thresholdPercent,
  };
};

export const toBudgetResponse = (budget: BudgetWithCategory, spent = 0) => ({
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
  rollover: budget.rollover,
  isActive: budget.isActive,
  category: budget.category,
  usage: toBudgetUsage(budget, spent),
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
