import { TransactionDirection } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Bounds of a classification rule (CLASS-001). */
export const RULE_PATTERN_MAX_LENGTH = 200;
export const RULE_PRIORITY_MAX = 1_000_000;

/**
 * A user rule. Patterns are literal text compared without case, diacritics,
 * or extra spaces ("contains" for merchant and description, "equals" for the
 * bank); at least one of them is required. The highest priority wins.
 */
export class CreateClassificationRuleDto {
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RULE_PATTERN_MAX_LENGTH)
  merchantPattern?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RULE_PATTERN_MAX_LENGTH)
  descriptionPattern?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RULE_PATTERN_MAX_LENGTH)
  bankName?: string | null;

  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RULE_PRIORITY_MAX)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * A partial rule change. Patterns and direction may be cleared with null;
 * categoryId, priority, and isActive may be omitted but never null.
 */
export class UpdateClassificationRuleDto {
  @ValidateIf(
    (dto: UpdateClassificationRuleDto) => dto.categoryId !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RULE_PATTERN_MAX_LENGTH)
  merchantPattern?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RULE_PATTERN_MAX_LENGTH)
  descriptionPattern?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(RULE_PATTERN_MAX_LENGTH)
  bankName?: string | null;

  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection | null;

  @ValidateIf((dto: UpdateClassificationRuleDto) => dto.priority !== undefined)
  @IsInt()
  @Min(0)
  @Max(RULE_PRIORITY_MAX)
  priority?: number;

  @ValidateIf((dto: UpdateClassificationRuleDto) => dto.isActive !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
