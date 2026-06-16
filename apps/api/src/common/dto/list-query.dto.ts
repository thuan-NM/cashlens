import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { FilterOperator, SortDirection } from '../types/list-query-config.type';

export class ListSorterDto {
  @IsString()
  field!: string;

  @IsIn(['asc', 'desc'])
  order!: SortDirection;
}

export class ListFilterDto {
  @IsString()
  field!: string;

  @IsIn([
    'eq',
    'ne',
    'contains',
    'startswith',
    'endswith',
    'in',
    'nin',
    'gt',
    'gte',
    'lt',
    'lte',
    'null',
    'nnull',
  ])
  operator!: FilterOperator;

  @IsOptional()
  value?: unknown;
}

export class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentPage?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListSorterDto)
  sorters?: ListSorterDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListFilterDto)
  filters?: ListFilterDto[];
}
