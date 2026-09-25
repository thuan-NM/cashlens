import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { GoalPriority, GoalStatus, Prisma } from '@prisma/client';

/**
 * OpenAPI description of `toGoalResponse` (its declared return type, so the
 * documentation cannot drift from the runtime shape).
 */
@ApiSchema({ name: 'Goal' })
export class GoalResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  type!: string | null;

  @ApiProperty()
  targetAmount!: number;

  @ApiProperty()
  savedAmount!: number;

  @ApiProperty({ minimum: 0, description: 'max(0, target − saved), exact' })
  remainingAmount!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  progressPercent!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  targetDate!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  months!: number | null;

  @ApiProperty({ enum: GoalPriority, enumName: 'GoalPriority' })
  priority!: GoalPriority;

  @ApiProperty({ enum: GoalStatus, enumName: 'GoalStatus' })
  status!: GoalStatus;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Prisma.JsonValue;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
