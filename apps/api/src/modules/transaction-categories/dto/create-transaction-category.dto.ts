import { Prisma, TransactionCategoryType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  IsInt,
} from 'class-validator';

export class CreateTransactionCategoryDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsEnum(TransactionCategoryType)
  type?: TransactionCategoryType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string;

  @IsOptional()
  @IsBoolean()
  excludeFromBudget?: boolean;

  @IsOptional()
  @IsBoolean()
  excludeFromAnalytics?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
