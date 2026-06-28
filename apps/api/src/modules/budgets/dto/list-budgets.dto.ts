import { BudgetPeriod } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ListBudgetsDto {
  @IsOptional()
  @IsDateString()
  month?: string;

  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;
}
