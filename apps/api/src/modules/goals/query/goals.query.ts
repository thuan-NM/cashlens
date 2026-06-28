import { GoalStatus, Prisma } from '@prisma/client';
import { ListGoalsDto } from '../dto/list-goals.dto';

export const buildGoalWhere = (
  userId: string,
  query: ListGoalsDto,
): Prisma.GoalWhereInput => ({
  userId,
  deletedAt: null,
  status: query.status ?? { not: GoalStatus.ARCHIVED },
});
