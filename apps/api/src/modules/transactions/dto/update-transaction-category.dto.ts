import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateTransactionCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string | null;
}
