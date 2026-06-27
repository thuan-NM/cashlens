import { ParserField, ParserRun, ParserTemplate } from '@prisma/client';
import { CreateParserTemplateDto } from './dto/create-parser-template.dto';
import { UpdateParserTemplateDto } from './dto/update-parser-template.dto';

export type ParserTemplateWithFields = ParserTemplate & {
  fields: ParserField[];
};

export const toParserTemplateCreateInput = (
  dto: CreateParserTemplateDto,
) => ({
  bankProviderId: dto.bankProviderId,
  name: dto.name,
  version: dto.version,
  channel: dto.channel,
  language: dto.language,
  directionHint: dto.directionHint,
  subjectPattern: dto.subjectPattern,
  bodyPattern: dto.bodyPattern,
  isActive: dto.isActive,
  priority: dto.priority,
  fields: {
    create: dto.fields,
  },
});

export const toParserTemplateUpdateInput = (
  dto: UpdateParserTemplateDto,
) => ({
  bankProviderId: dto.bankProviderId,
  name: dto.name,
  version: dto.version,
  channel: dto.channel,
  language: dto.language,
  directionHint: dto.directionHint,
  subjectPattern: dto.subjectPattern,
  bodyPattern: dto.bodyPattern,
  isActive: dto.isActive,
  priority: dto.priority,
  ...(dto.fields
    ? {
        fields: {
          deleteMany: {},
          create: dto.fields,
        },
      }
    : {}),
});

export const toParserTemplateResponse = (
  template: ParserTemplateWithFields,
) => ({
  ...template,
  createdAt: template.createdAt.toISOString(),
  updatedAt: template.updatedAt.toISOString(),
  fields: template.fields.map((field) => ({
    ...field,
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  })),
});

export const toParserRunResponse = (run: ParserRun) => ({
  ...run,
  confidenceScore:
    run.confidenceScore === null ? null : Number(run.confidenceScore),
  createdAt: run.createdAt.toISOString(),
});
