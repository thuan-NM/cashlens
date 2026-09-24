import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BudgetSpendScope,
  budgetSpend,
} from '../../common/finance/budget-spend.query';
import { loadFinancialContext } from '../../common/finance/financial-summary.query';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { ListBudgetsDto } from './dto/list-budgets.dto';
import { buildBudgetWhere } from './query/budgets.query';

const budgetInclude = {
  category: true,
} satisfies Prisma.BudgetInclude;

@Injectable()
export class BudgetsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string, query: ListBudgetsDto) {
    return this.prisma.budget.findMany({
      where: buildBudgetWhere(userId, query),
      include: budgetInclude,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.budget.findFirst({
      where: { id, userId, deletedAt: null },
      include: budgetInclude,
    });
  }

  create(data: Prisma.BudgetUncheckedCreateInput) {
    return this.prisma.budget.create({ data, include: budgetInclude });
  }

  // Writes carry the owner predicate themselves (SEC-001); null means not found.
  updateById(
    userId: string,
    id: string,
    data: Prisma.BudgetUncheckedUpdateInput,
  ) {
    return nullIfNotFound(
      this.prisma.budget.update({
        where: { id, userId, deletedAt: null },
        data,
        include: budgetInclude,
      }),
    );
  }

  archiveById(userId: string, id: string) {
    return nullIfNotFound(
      this.prisma.budget.update({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      }),
    );
  }

  categoryExistsForUser(userId: string, categoryId: string) {
    return this.prisma.transactionCategory.findFirst({
      where: {
        id: categoryId,
        status: 'ACTIVE',
        excludeFromBudget: false,
        OR: [{ userId: null }, { userId }],
      },
      select: { id: true },
    });
  }

  /** Timezone, month-start day, and base currency of the account. */
  financialContext(userId: string) {
    return loadFinancialContext(this.prisma, userId);
  }

  /** The shared spend aggregate (BUDGET-002), per scope id. */
  spend(userId: string, scopes: BudgetSpendScope[]) {
    return budgetSpend(this.prisma, userId, scopes);
  }
}
