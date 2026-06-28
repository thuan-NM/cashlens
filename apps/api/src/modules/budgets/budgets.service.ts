import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../../common/types/request-user.type';
import { BudgetMonthQueryDto } from './dto/budget-month-query.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { ListBudgetsDto } from './dto/list-budgets.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import {
  toBudgetResponse,
  toCreateBudgetInput,
  toUpdateBudgetInput,
} from './budgets.mapper';
import { BudgetsRepository } from './budgets.repository';
import { monthRange } from './query/budgets.query';

@Injectable()
export class BudgetsService {
  constructor(private readonly budgetsRepository: BudgetsRepository) {}

  async list(user: RequestUser, query: ListBudgetsDto) {
    const range = monthRange(query.month);
    const budgets = await this.budgetsRepository.listByUser(user.id, query);
    const spentMap = await this.spentMap(user.id, budgets, range);

    return budgets.map((budget) =>
      toBudgetResponse(
        budget,
        budget.categoryId ? (spentMap.get(budget.categoryId) ?? 0) : 0,
      ),
    );
  }

  async summary(user: RequestUser, query: BudgetMonthQueryDto) {
    const budgets = await this.list(user, { month: query.month });
    const totalLimit = budgets.reduce((sum, budget) => sum + budget.amount, 0);
    const totalSpent = budgets.reduce(
      (sum, budget) => sum + budget.usage.spent,
      0,
    );

    return {
      month: monthRange(query.month).from.toISOString().slice(0, 7),
      totalLimit,
      totalSpent,
      remaining: Math.max(0, totalLimit - totalSpent),
      percentUsed:
        totalLimit === 0 ? 0 : Math.round((totalSpent / totalLimit) * 100),
      overLimitCount: budgets.filter((budget) => budget.usage.isOverLimit)
        .length,
      nearThresholdCount: budgets.filter(
        (budget) => budget.usage.isNearThreshold,
      ).length,
    };
  }

  async alerts(user: RequestUser, query: BudgetMonthQueryDto) {
    const budgets = await this.list(user, { month: query.month });

    return budgets
      .filter((budget) => budget.usage.isNearThreshold)
      .sort((a, b) => b.usage.percentUsed - a.usage.percentUsed);
  }

  async findById(user: RequestUser, id: string) {
    const budget = await this.budgetsRepository.findByIdForUser(user.id, id);

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    const range = monthRange(budget.startsAt.toISOString().slice(0, 7));
    const spentMap = await this.spentMap(user.id, [budget], range);

    return toBudgetResponse(
      budget,
      budget.categoryId ? (spentMap.get(budget.categoryId) ?? 0) : 0,
    );
  }

  async create(user: RequestUser, dto: CreateBudgetDto) {
    await this.assertCategory(user.id, dto.categoryId);
    const budget = await this.budgetsRepository.create(
      toCreateBudgetInput(user.id, dto),
    );
    return toBudgetResponse(budget);
  }

  async update(user: RequestUser, id: string, dto: UpdateBudgetDto) {
    await this.findById(user, id);
    await this.assertCategory(user.id, dto.categoryId);
    const budget = await this.budgetsRepository.updateById(
      id,
      toUpdateBudgetInput(dto),
    );
    return toBudgetResponse(budget);
  }

  async archive(user: RequestUser, id: string) {
    await this.findById(user, id);
    await this.budgetsRepository.archiveById(id);
    return { id };
  }

  private async assertCategory(userId: string, categoryId?: string) {
    if (!categoryId) {
      return;
    }

    const category = await this.budgetsRepository.categoryExistsForUser(
      userId,
      categoryId,
    );
    if (!category) {
      throw new BadRequestException('Category is not available for budgets');
    }
  }

  private spentMap(
    userId: string,
    budgets: { categoryId: string | null }[],
    range: { from: Date; to: Date },
  ) {
    const categoryIds = Array.from(
      new Set(
        budgets
          .map((budget) => budget.categoryId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    return this.budgetsRepository.spentByCategory(userId, categoryIds, range);
  }
}
