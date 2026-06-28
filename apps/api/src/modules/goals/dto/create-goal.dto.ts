import { GoalPriority, GoalStatus, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  targetAmount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  savedAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  months?: number;

  @IsOptional()
  @IsEnum(GoalPriority)
  priority?: GoalPriority;

  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
