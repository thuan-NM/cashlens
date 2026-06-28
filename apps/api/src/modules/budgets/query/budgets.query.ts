import { Prisma } from '@prisma/client';
import { ListBudgetsDto } from '../dto/list-budgets.dto';

export const monthRange = (month?: string) => {
  const base = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const from = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1),
  );

  return { from, to };
};

export const buildBudgetWhere = (
  userId: string,
  query: ListBudgetsDto,
): Prisma.BudgetWhereInput => {
  const range = monthRange(query.month);

  return {
    userId,
    deletedAt: null,
    period: query.period,
    isActive: query.activeOnly === false ? undefined : true,
    startsAt: { lt: range.to },
    OR: [{ endsAt: null }, { endsAt: { gte: range.from } }],
  };
};
