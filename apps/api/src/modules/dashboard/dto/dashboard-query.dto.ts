import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class DashboardMonthQueryDto {
  @IsOptional()
  @IsString()
  month?: string;
}

export class DashboardCashflowQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}
