import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class MarkDuplicateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  duplicateOfTransactionId?: string | null;
}
