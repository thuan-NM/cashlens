import { GoalScenarioType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class GoalSimulationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;

  @IsOptional()
  @IsEnum(GoalScenarioType)
  scenario?: GoalScenarioType;
}
