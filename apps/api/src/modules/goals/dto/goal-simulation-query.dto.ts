import { GoalScenarioType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

/**
 * `GET /goals/:id/simulation` (contract `GoalFeasibility`, T061). Without
 * `months` the goal's own horizon applies: its target date, else its planned
 * months, else the visible 6-month default (`horizonSource`).
 */
export class GoalSimulationQueryDto {
  /** A what-if horizon of N user months from the current one (`QUERY`). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;

  /**
   * Retained for compatibility. INSTALLMENT applies no inferred rate or term
   * (GOAL-007): the result equals FULL and its reason says so.
   */
  @IsOptional()
  @IsEnum(GoalScenarioType)
  scenario?: GoalScenarioType;
}
