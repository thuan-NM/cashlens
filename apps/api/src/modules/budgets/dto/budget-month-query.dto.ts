import { IsDateString, IsOptional } from 'class-validator';

export class BudgetMonthQueryDto {
  @IsOptional()
  @IsDateString()
  month?: string;
}
