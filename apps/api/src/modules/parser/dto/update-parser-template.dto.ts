import { PartialType } from '@nestjs/swagger';
import { CreateParserTemplateDto } from './create-parser-template.dto';

export class UpdateParserTemplateDto extends PartialType(
  CreateParserTemplateDto,
) {}
