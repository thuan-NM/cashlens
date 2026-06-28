import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
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

  updateById(id: string, data: Prisma.GoalUncheckedUpdateInput) {
    return this.prisma.goal.update({ where: { id }, data });
  }

  archiveById(id: string) {
    return this.prisma.goal.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
  }

  contribute(id: string, amount: number) {
    return this.prisma.goal.update({
      where: { id },
      data: { savedAmount: { increment: amount } },
    });
  }
}
