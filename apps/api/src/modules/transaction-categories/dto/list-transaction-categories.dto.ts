import {
  TransactionCategoryStatus,
  TransactionCategoryType,
} from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListTransactionCategoriesDto {
  @IsOptional()
  @IsEnum(TransactionCategoryType)
  type?: TransactionCategoryType;

  @IsOptional()
  @IsEnum(TransactionCategoryStatus)
  status?: TransactionCategoryStatus;
}
