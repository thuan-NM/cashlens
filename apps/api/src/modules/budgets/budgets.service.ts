import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Budget } from '@prisma/client';
import {
  MonthlyInstanceResult,
  monthlyInstanceAt,
  monthlyInstanceForMonth,
} from '../../common/finance/budget-spend.query';
import {
  PeriodSettings,
  TimeRange,
  normalizeCurrency,
  parseMonthKey,
  userMonthForKey,
} from '../../common/finance/financial-period-policy';
import { Clock } from '../../common/time/clock';
import type { RequestUser } from '../../common/types/request-user.type';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { BudgetMonthQueryDto } from './dto/budget-month-query.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { ListBudgetsDto } from './dto/list-budgets.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import {
  BudgetUsageContext,
  BudgetWithCategory,
  toBudgetResponse,
  toCreateBudgetInput,
  toUpdateBudgetInput,
} from './budgets.mapper';
import { BudgetsRepository } from './budgets.repository';
import { monthRange } from './query/budgets.query';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly budgetsRepository: BudgetsRepository,
    private readonly clock: Clock,
    private readonly alertEvaluation: AlertEvaluationService,
  ) {}

  async list(user: RequestUser, query: ListBudgetsDto) {
    const budgets = await this.budgetsRepository.listByUser(user.id, query);
    return this.withUsage(user.id, budgets, () => query.month);
  }

  /**
   * Totals of the budgets in the account's base currency only: amounts in
   * different currencies are never added together. The counts still cover
   * every budget.
   */
  async summary(user: RequestUser, query: BudgetMonthQueryDto) {
    const budgets = await this.list(user, { month: query.month });
    const { baseCurrency } = await this.budgetsRepository.financialContext(
      user.id,
    );
    const currency = normalizeCurrency(baseCurrency);
    const inBase = budgets.filter(
      (budget) => normalizeCurrency(budget.currency) === currency,
    );
    const totalLimit = inBase.reduce((sum, budget) => sum + budget.amount, 0);
    const totalSpent = inBase.reduce(
      (sum, budget) => sum + budget.usage.spent,
      0,
    );

    return {
      month: monthRange(query.month).from.toISOString().slice(0, 7),
      currency,
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

  /** Read-only projection with the shared threshold rule; never writes alerts. */
  async alerts(user: RequestUser, query: BudgetMonthQueryDto) {
    const budgets = await this.list(user, { month: query.month });

    return budgets
      .filter((budget) => budget.usage.isNearThreshold)
      .sort((a, b) => b.usage.percentUsed - a.usage.percentUsed);
  }

  /**
   * A MONTHLY budget reports its current period instance; the other periods
   * keep their existing projection, the calendar month of `startsAt`.
   */
  async findById(user: RequestUser, id: string) {
    const budget = await this.budgetsRepository.findByIdForUser(user.id, id);

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    const [response] = await this.withUsage(user.id, [budget], (item) =>
      item.period === 'MONTHLY'
        ? undefined
        : item.startsAt.toISOString().slice(0, 7),
    );
    return response;
  }

  async create(user: RequestUser, dto: CreateBudgetDto) {
    await this.assertCategory(user.id, dto.categoryId);
    const budget = await this.budgetsRepository.create(
      toCreateBudgetInput(user.id, dto),
    );
    // After the write; evaluation never fails it (BUDGET-003, ALERT-009).
    await this.alertEvaluation.onBudgetChanged(user.id);
    return this.findById(user, budget.id);
  }

  async update(user: RequestUser, id: string, dto: UpdateBudgetDto) {
    await this.findById(user, id);
    await this.assertCategory(user.id, dto.categoryId);
    const budget = await this.budgetsRepository.updateById(
      user.id,
      id,
      toUpdateBudgetInput(dto),
    );
    if (!budget) {
      throw new NotFoundException('Budget not found');
    }
    await this.alertEvaluation.onBudgetChanged(user.id);
    return this.findById(user, id);
  }

  async archive(user: RequestUser, id: string) {
    await this.findById(user, id);
    if (!(await this.budgetsRepository.archiveById(user.id, id))) {
      throw new NotFoundException('Budget not found');
    }
    // An archived budget's open alerts resolve (TARGET_REMOVED).
    await this.alertEvaluation.onBudgetChanged(user.id);
    return { id };
  }

  /**
   * Explicit recalculation (BUDGET-003): re-evaluates the owner's budget
   * conditions now and returns the budget's current usage with the number of
   * alerts opened and resolved.
   */
  async recalculate(user: RequestUser, id: string) {
    await this.findById(user, id);
    const evaluation = await this.alertEvaluation.onBudgetChanged(user.id);
    return {
      budget: await this.findById(user, id),
      alertChanges: {
        evaluated: evaluation.ok,
        created: evaluation.created,
        resolved: evaluation.resolved,
      },
    };
  }

  /**
   * Responses with usage from the shared spend aggregate. `monthOf` names the
   * requested month (`YYYY-MM…`) of a budget, or undefined for "now".
   */
  private async withUsage(
    userId: string,
    budgets: BudgetWithCategory[],
    monthOf: (budget: Budget) => string | undefined,
  ) {
    if (!budgets.length) return [];
    const { settings } = await this.budgetsRepository.financialContext(userId);
    const now = this.clock.now();
    const contexts = budgets.map((budget) =>
      this.usageContext(budget, monthOf(budget), settings, now),
    );
    const spend = await this.budgetsRepository.spend(
      userId,
      budgets.flatMap((budget, index) => {
        const range = contexts[index].range;
        return range
          ? [
              {
                id: budget.id,
                categoryId: budget.categoryId,
                currency: budget.currency,
                range,
              },
            ]
          : [];
      }),
    );
    return budgets.map((budget, index) =>
      toBudgetResponse(budget, spend.get(budget.id) ?? 0, contexts[index]),
    );
  }

  private usageContext(
    budget: Budget,
    month: string | undefined,
    settings: PeriodSettings,
    now: Date,
  ): BudgetUsageContext {
    if (budget.period !== 'MONTHLY') {
      const range: TimeRange = monthRange(
        month ?? now.toISOString().slice(0, 7),
      );
      return { basis: 'CALENDAR_MONTH_APPROXIMATION', range };
    }
    let result: MonthlyInstanceResult;
    if (month) {
      const key = month.slice(0, 7);
      if (!parseMonthKey(key)) {
        throw new BadRequestException(['month must be a YYYY-MM month']);
      }
      result = monthlyInstanceForMonth(
        budget,
        userMonthForKey(key, settings),
        settings,
      );
    } else {
      result = monthlyInstanceAt(budget, now, settings);
    }
    return {
      basis: 'PERIOD_INSTANCE',
      range: result.supported && result.instance ? result.instance.usage : null,
    };
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
}
