import { Injectable, NotFoundException } from '@nestjs/common';
import { GoalScenarioType } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateGoalDto } from './dto/create-goal.dto';
import { GoalContributionDto } from './dto/goal-contribution.dto';
import { GoalSimulationQueryDto } from './dto/goal-simulation-query.dto';
import { ListGoalsDto } from './dto/list-goals.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import {
  simulateGoal,
  toCreateGoalInput,
  toGoalResponse,
  toUpdateGoalInput,
} from './goals.mapper';
import { GoalsRepository } from './goals.repository';

@Injectable()
export class GoalsService {
  constructor(private readonly goalsRepository: GoalsRepository) {}

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
    return toGoalResponse(goal);
  }

  async update(user: RequestUser, id: string, dto: UpdateGoalDto) {
    await this.findById(user, id);
    const goal = await this.goalsRepository.updateById(
      id,
      toUpdateGoalInput(dto),
    );
    return toGoalResponse(goal);
  }

  async archive(user: RequestUser, id: string) {
    await this.findById(user, id);
    await this.goalsRepository.archiveById(id);
    return { id };
  }

  async contribute(user: RequestUser, id: string, dto: GoalContributionDto) {
    await this.findById(user, id);
    const goal = await this.goalsRepository.contribute(id, dto.amount);
    return toGoalResponse(goal);
  }

  async simulate(user: RequestUser, id: string, query: GoalSimulationQueryDto) {
    const goal = await this.goalsRepository.findByIdForUser(user.id, id);

    if (!goal) {
      throw new NotFoundException('Goal not found');
    }

    return simulateGoal(
      goal,
      query.months ?? goal.months ?? 6,
      query.scenario ?? GoalScenarioType.FULL,
    );
  }
}
