import { GoalStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListGoalsDto {
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;
}
