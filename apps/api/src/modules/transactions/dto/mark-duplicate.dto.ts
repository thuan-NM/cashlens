import { IsOptional, IsString } from 'class-validator';

export class MarkDuplicateDto {
  @IsOptional()
  @IsString()
  duplicateOfTransactionId?: string | null;
}
