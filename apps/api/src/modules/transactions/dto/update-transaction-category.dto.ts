import { IsOptional, IsString } from 'class-validator';

export class UpdateTransactionCategoryDto {
  @IsOptional()
  @IsString()
  categoryId?: string | null;
}
