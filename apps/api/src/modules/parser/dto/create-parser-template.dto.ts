import {
  ParserChannel,
  ParserFieldType,
  TransactionDirection,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ParserFieldDto {
  @IsString()
  @MaxLength(64)
  fieldName!: string;

  @IsEnum(ParserFieldType)
  fieldType!: ParserFieldType;

  @IsString()
  @MaxLength(500)
  regexPattern!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  regexGroupIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  normalizer?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fallbackValue?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class CreateParserTemplateDto {
  @IsString()
  bankProviderId!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsEnum(ParserChannel)
  channel?: ParserChannel;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  language?: string;

  @IsOptional()
  @IsEnum(TransactionDirection)
  directionHint?: TransactionDirection;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subjectPattern?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bodyPattern?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ParserFieldDto)
  fields!: ParserFieldDto[];
}
