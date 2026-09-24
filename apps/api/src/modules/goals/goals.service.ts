import { Injectable, NotFoundException } from '@nestjs/common';
import { GoalScenarioType } from '@prisma/client';
import { Clock } from '../../common/time/clock';
import type { RequestUser } from '../../common/types/request-user.type';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { GoalContributionDto } from './dto/goal-contribution.dto';
import { GoalSimulationQueryDto } from './dto/goal-simulation-query.dto';
import { ListGoalsDto } from './dto/list-goals.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { computeFeasibility } from './goal-feasibility';
import {
  toCreateGoalInput,
  toGoalFeasibilityResponse,
  toGoalResponse,
  toUpdateGoalInput,
} from './goals.mapper';
import { GoalsRepository } from './goals.repository';

@Injectable()
export class GoalsService {
  constructor(
    private readonly goalsRepository: GoalsRepository,
    private readonly clock: Clock,
    private readonly alerts: AlertEvaluationService,
  ) {}

  async list(user: RequestUser, query: ListGoalsDto) {
    const goals = await this.goalsRepository.listByUser(user.id, query);
    return goals.map(toGoalResponse);
  }

  async findById(user: RequestUser, id: string) {
    const goal = await this.goalsRepository.findByIdForUser(user.id, id);

    if (!goal) {
      throw new NotFoundException('Goal not found');
    }

    return toGoalResponse(goal);
  }

  async create(user: RequestUser, dto: CreateGoalDto) {
    const goal = await this.goalsRepository.create(
      toCreateGoalInput(user.id, dto),
    );
    // After the write; evaluation never fails it (ALERT-009 goal risk).
    await this.alerts.onGoalChanged(user.id);
    return toGoalResponse(goal);
  }

  async update(user: RequestUser, id: string, dto: UpdateGoalDto) {
    await this.findById(user, id);
    const goal = this.found(
      await this.goalsRepository.updateById(
        user.id,
        id,
        toUpdateGoalInput(dto),
      ),
    );
    await this.alerts.onGoalChanged(user.id);
    return toGoalResponse(goal);
  }

  async archive(user: RequestUser, id: string) {
    await this.findById(user, id);
    this.found(await this.goalsRepository.archiveById(user.id, id));
    await this.alerts.onGoalChanged(user.id);
    return { id };
  }

  async contribute(user: RequestUser, id: string, dto: GoalContributionDto) {
    await this.findById(user, id);
    const goal = this.found(
      await this.goalsRepository.contribute(user.id, id, dto.amount),
    );
    await this.alerts.onGoalChanged(user.id);
    return toGoalResponse(goal);
  }

  private found<T>(goal: T | null): T {
    if (!goal) {
      throw new NotFoundException('Goal not found');
    }
    return goal;
  }

  /**
   * Feasibility from the owner's persisted data (GOAL-002–GOAL-006): computed
   * on every read, so a goal, contribution, or transaction change is reflected
   * at once, and side-effect free (it never creates or resolves alerts).
   */
  async simulate(user: RequestUser, id: string, query: GoalSimulationQueryDto) {
    const goal = await this.goalsRepository.findByIdForUser(user.id, id);

    if (!goal) {
      throw new NotFoundException('Goal not found');
    }

    const now = this.clock.now();
    const { settings } = await this.goalsRepository.financialContext(user.id);
    const observation = await this.goalsRepository.observation(
      user.id,
      goal.currency,
      now,
      settings,
    );
    return toGoalFeasibilityResponse(
      goal,
      computeFeasibility({
        goal,
        now,
        queryMonths: query.months,
        observation,
        userMonthPolicy: settings,
      }),
      query.scenario ?? GoalScenarioType.FULL,
    );
  }
}
