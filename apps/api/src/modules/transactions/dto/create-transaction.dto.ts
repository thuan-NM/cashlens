import {
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Soft deletion goes through DELETE /transactions/:id only (audited, SEC-006).
const WRITABLE_STATUSES = Object.values(TransactionStatus).filter(
  (status) => status !== TransactionStatus.DELETED,
);

/**
 * Owner-writable transaction fields. Ownership (userId) and classification
 * provenance (classificationSource, classificationConfidence) are derived on
 * the server, so the global ValidationPipe rejects them (SEC-004, TX-002).
 */
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
  @IsNotEmpty()
  financialAccountId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
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
  @IsIn(WRITABLE_STATUSES)
  status?: TransactionStatus;

  @IsOptional()
  @IsBoolean()
  isDuplicate?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  duplicateOfTransactionId?: string;

  @IsOptional()
  @IsString()
  userNote?: string;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
