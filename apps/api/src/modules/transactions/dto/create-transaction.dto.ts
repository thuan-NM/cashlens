import {
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsCurrencyCode,
  IsInstant,
  IsMoney,
  MAX_TRANSACTION_AMOUNT,
} from '../../../common/finance/finance-validation';

// Soft deletion goes through DELETE /transactions/:id only (audited, SEC-006).
const WRITABLE_STATUSES = Object.values(TransactionStatus).filter(
  (status) => status !== TransactionStatus.DELETED,
);

/**
 * Owner-writable transaction fields. Ownership (userId) and classification
 * provenance (classificationSource, classificationConfidence) are derived on
 * the server, so the global ValidationPipe rejects them (SEC-004, TX-002).
 * The amount is always positive; the direction carries the sign.
 */
export class CreateTransactionDto {
  @Type(() => Number)
  @IsMoney()
  @IsPositive({ message: 'amount must be greater than 0' })
  @Max(MAX_TRANSACTION_AMOUNT, {
    message: `amount must not be greater than ${MAX_TRANSACTION_AMOUNT}`,
  })
  amount!: number;

  @IsOptional()
  @IsCurrencyCode()
  currency?: string;

  @IsEnum(TransactionDirection)
  direction!: TransactionDirection;

  @IsInstant()
  transactionTime!: string;

  @IsOptional()
  @IsInstant()
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
  @IsMoney()
  @Min(-MAX_TRANSACTION_AMOUNT)
  @Max(MAX_TRANSACTION_AMOUNT)
  balanceAfter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsMoney()
  @Min(0)
  @Max(MAX_TRANSACTION_AMOUNT)
  feeAmount?: number;

  @IsOptional()
  @IsIn(WRITABLE_STATUSES)
  status?: TransactionStatus;

  /** Must agree with duplicateOfTransactionId; see TransactionsService. */
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
