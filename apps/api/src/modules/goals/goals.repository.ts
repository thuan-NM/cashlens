import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { completedMonthCashflow } from '../../common/finance/completed-month-cashflow';
import type { PeriodSettings } from '../../common/finance/financial-period-policy';
import { loadFinancialContext } from '../../common/finance/financial-summary.query';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { ListGoalsDto } from './dto/list-goals.dto';
import { buildGoalWhere } from './query/goals.query';

@Injectable()
export class GoalsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string, query: ListGoalsDto) {
    return this.prisma.goal.findMany({
      where: buildGoalWhere(userId, query),
      orderBy: [{ targetDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.goal.findFirst({
      where: { id, userId, deletedAt: null },
    });
  }

  create(data: Prisma.GoalUncheckedCreateInput) {
    return this.prisma.goal.create({ data });
  }

  // Writes carry the owner predicate themselves (SEC-001); null means not found.
  updateById(
    userId: string,
    id: string,
    data: Prisma.GoalUncheckedUpdateInput,
  ) {
    return nullIfNotFound(
      this.prisma.goal.update({
        where: { id, userId, deletedAt: null },
        data,
      }),
    );
  }

  archiveById(userId: string, id: string) {
    return nullIfNotFound(
      this.prisma.goal.update({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date(), status: 'ARCHIVED' },
      }),
    );
  }

  /** The account's timezone and month-start day (user months, DASH-002). */
  financialContext(userId: string) {
    return loadFinancialContext(this.prisma, userId);
  }

  /** Completed-month net cashflow of the goal's currency (GOAL-003). */
  observation(
    userId: string,
    currency: string,
    now: Date,
    settings: PeriodSettings,
  ) {
    return completedMonthCashflow(this.prisma, userId, currency, now, settings);
  }

  contribute(userId: string, id: string, amount: number) {
    return nullIfNotFound(
      this.prisma.goal.update({
        where: { id, userId, deletedAt: null },
        data: { savedAmount: { increment: amount } },
      }),
    );
  }
}
