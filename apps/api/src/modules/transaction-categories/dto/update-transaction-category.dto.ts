import { PartialType } from '@nestjs/swagger';
import { TransactionCategoryStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateTransactionCategoryDto } from './create-transaction-category.dto';

export class UpdateTransactionCategoryDto extends PartialType(
  CreateTransactionCategoryDto,
) {
  @IsOptional()
  @IsEnum(TransactionCategoryStatus)
  status?: TransactionCategoryStatus;
}
