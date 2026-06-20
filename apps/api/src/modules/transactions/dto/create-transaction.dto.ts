import {
  ClassificationSource,
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateTransactionDto {
  @Type(() => Number)
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsEnum(TransactionDirection)
  direction!: TransactionDirection;

  @IsDateString()
  transactionTime!: string;

  @IsOptional()
  @IsDateString()
  postedDate?: string;

  @IsOptional()
  @IsString()
  financialAccountId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchantName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  counterpartyName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balanceAfter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  feeAmount?: number;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  @IsBoolean()
  isDuplicate?: boolean;

  @IsOptional()
  @IsString()
  duplicateOfTransactionId?: string;

  @IsOptional()
  @IsEnum(ClassificationSource)
  classificationSource?: ClassificationSource;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  classificationConfidence?: number;

  @IsOptional()
  @IsString()
  userNote?: string;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
