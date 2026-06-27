import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEmailListenRuleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  emailConnectionId?: string;

  @IsOptional()
  @IsString()
  bankProviderId?: string;

  @IsOptional()
  @IsString()
  senderEmail?: string;

  @IsOptional()
  @IsString()
  senderDomain?: string;

  @IsOptional()
  @IsString()
  subjectContains?: string;

  @IsOptional()
  @IsString()
  bodyContains?: string;

  @IsOptional()
  @IsDateString()
  syncFromDate?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number;
}
