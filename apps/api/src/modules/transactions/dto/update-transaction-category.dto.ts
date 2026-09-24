import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

/**
 * The owner's manual category (TX-004): a category id, or null to clear it.
 * Either way the choice is locked against automatic classification, so the
 * key is required; an empty body is not a correction.
 */
export class UpdateTransactionCategoryDto {
  @ValidateIf((dto: UpdateTransactionCategoryDto) => dto.categoryId !== null)
  @IsString({ message: 'categoryId must be a category id or null' })
  @IsNotEmpty()
  categoryId!: string | null;
}
