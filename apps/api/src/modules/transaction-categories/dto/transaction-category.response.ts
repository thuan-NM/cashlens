import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  TransactionCategory,
  TransactionCategoryStatus,
  TransactionCategoryType,
} from '@prisma/client';
import type { ExpectTrue, SameKeys } from '../../../common/swagger/same-keys';

/**
 * OpenAPI description of `toTransactionCategoryResponse` (its declared return
 * type). A category embedded in a transaction, breakdown row, or hot budget is
 * the serialized entity, which has exactly these fields (checked below).
 */
@ApiSchema({ name: 'TransactionCategory' })
export class TransactionCategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null for system categories',
  })
  userId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({
    enum: TransactionCategoryType,
    enumName: 'TransactionCategoryType',
  })
  type!: TransactionCategoryType;

  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;

  @ApiProperty({ type: String, nullable: true })
  color!: string | null;

  @ApiProperty()
  isSystem!: boolean;

  @ApiProperty()
  excludeFromBudget!: boolean;

  @ApiProperty({ description: 'Never shown in analytics breakdowns' })
  excludeFromAnalytics!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({
    enum: TransactionCategoryStatus,
    enumName: 'TransactionCategoryStatus',
  })
  status!: TransactionCategoryStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** The embedded (serialized) entity has exactly the documented fields. */
export type TransactionCategoryEntityIsDocumented = ExpectTrue<
  SameKeys<TransactionCategory, TransactionCategoryResponseDto>
>;
