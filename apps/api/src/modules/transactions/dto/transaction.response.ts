import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  AccountStatus,
  AccountType,
  ClassificationSource,
  FinancialAccount,
  Prisma,
  TransactionCategory,
  TransactionDirection,
  TransactionSourceType,
  TransactionStatus,
} from '@prisma/client';
import { TotalsSummaryResponseDto } from '../../../common/finance/finance-totals.response';
import type { ExpectTrue, SameKeys } from '../../../common/swagger/same-keys';
import { TransactionCategoryResponseDto } from '../../transaction-categories/dto/transaction-category.response';

/**
 * OpenAPI description of the financial account embedded in a transaction
 * response. It is the stored entity serialized as-is, so money columns are
 * decimal strings and timestamps are ISO strings (the field list is checked
 * against the entity below).
 */
@ApiSchema({ name: 'TransactionAccount' })
export class TransactionAccountResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  bankProviderId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  institutionName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  accountMask!: string | null;

  @ApiProperty({ enum: AccountType, enumName: 'AccountType' })
  type!: AccountType;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Decimal string, e.g. "1250000.00"' })
  openingBalance!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Decimal string' })
  currentBalance!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Decimal string' })
  creditLimit!: string | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty({ enum: AccountStatus, enumName: 'AccountStatus' })
  status!: AccountStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  balanceUpdatedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSyncedAt!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Prisma.JsonValue;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: string | null;
}

/** The embedded (serialized) entity has exactly the documented fields. */
export type TransactionAccountEntityIsDocumented = ExpectTrue<
  SameKeys<FinancialAccount, TransactionAccountResponseDto>
>;

/**
 * OpenAPI description of `toTransactionResponse` (its declared return type).
 * `account` and `category` are the embedded entities; their TypeScript types
 * are the Prisma entities the mapper returns, documented by the schemas above.
 */
@ApiSchema({ name: 'Transaction' })
export class TransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  rawEmailId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  emailMessageId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  categoryId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  financialAccountId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankProviderId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bankName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  merchantName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  counterpartyName!: string | null;

  @ApiProperty({
    enum: TransactionSourceType,
    enumName: 'TransactionSourceType',
  })
  sourceType!: TransactionSourceType;

  @ApiProperty({ type: String, nullable: true })
  sourceId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  externalTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  transactionCode!: string | null;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: TransactionDirection, enumName: 'TransactionDirection' })
  direction!: TransactionDirection;

  @ApiProperty({ format: 'date-time' })
  transactionTime!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  postedDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true })
  normalizedDescription!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  balanceAfter!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  feeAmount!: number | null;

  @ApiProperty({ enum: TransactionStatus, enumName: 'TransactionStatus' })
  status!: TransactionStatus;

  @ApiProperty()
  isDuplicate!: boolean;

  @ApiProperty({ type: String, nullable: true })
  duplicateOfTransactionId!: string | null;

  @ApiProperty({ enum: ClassificationSource, enumName: 'ClassificationSource' })
  classificationSource!: ClassificationSource;

  @ApiProperty({ type: Number, nullable: true })
  classificationConfidence!: number | null;

  @ApiProperty({ type: String, nullable: true })
  classificationRuleId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  classifiedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  userNote!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Prisma.JsonValue;

  @ApiProperty({ type: () => TransactionAccountResponseDto, nullable: true })
  account!: FinancialAccount | null;

  @ApiProperty({ type: () => TransactionCategoryResponseDto, nullable: true })
  category!: TransactionCategory | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * OpenAPI description of `GET /transactions`: one page plus the eligible
 * totals of every row matching the same filters.
 */
@ApiSchema({ name: 'TransactionPage' })
export class TransactionListResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  data!: TransactionResponseDto[];

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1 })
  limit!: number;

  @ApiProperty({ type: TotalsSummaryResponseDto })
  totals!: TotalsSummaryResponseDto;
}
