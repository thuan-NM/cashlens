import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { GoalScenarioType } from '@prisma/client';
import type { FeasibilityStatus, HorizonSource } from '../goal-feasibility';

const HORIZON_SOURCES: HorizonSource[] = [
  'QUERY',
  'TARGET_DATE',
  'GOAL_MONTHS',
  'DEFAULT',
];
const FEASIBILITY_STATUSES: FeasibilityStatus[] = [
  'SAFE',
  'ACCEPTABLE',
  'RISKY',
  'NOT_RECOMMENDED',
  'INSUFFICIENT_DATA',
];

/**
 * OpenAPI description of `toGoalFeasibilityResponse` (contracts/openapi.yaml
 * `GoalFeasibility`). Documentation only; the mapper defines the runtime shape.
 */
@ApiSchema({ name: 'GoalFeasibility' })
export class GoalFeasibilityResponseDto {
  @ApiProperty()
  goalId!: string;

  @ApiPropertyOptional({ enum: GoalScenarioType, enumName: 'GoalScenarioType' })
  scenario?: GoalScenarioType;

  @ApiProperty({
    minimum: 0,
    description: 'User months from the current one through the deadline month',
  })
  months!: number;

  @ApiProperty({ enum: HORIZON_SOURCES })
  horizonSource!: HorizonSource;

  @ApiProperty()
  pastDeadline!: boolean;

  @ApiProperty()
  targetAmount!: number;

  @ApiProperty()
  savedAmount!: number;

  @ApiProperty({ minimum: 0 })
  remainingAmount!: number;

  @ApiPropertyOptional()
  totalCost?: number;

  @ApiProperty({ minimum: 0 })
  monthlyRequired!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 100,
    nullable: true,
    description: 'null when INSUFFICIENT_DATA',
  })
  feasibilityScore!: number | null;

  @ApiProperty({ enum: FEASIBILITY_STATUSES })
  status!: FeasibilityStatus;

  @ApiPropertyOptional({ type: Number, nullable: true })
  availableMonthlyCashflow?: number | null;

  @ApiProperty({ type: [String], example: ['2026-06', '2026-07', '2026-08'] })
  observationMonths!: string[];

  @ApiPropertyOptional({ minimum: 0 })
  monthsRequired?: number;

  @ApiPropertyOptional({ description: 'Comma-separated reason codes' })
  reason?: string;
}
