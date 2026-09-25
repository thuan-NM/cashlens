import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiSchema,
  getSchemaPath,
} from '@nestjs/swagger';

/**
 * OpenAPI description of the success envelope that BaseResponseInterceptor
 * wraps around every response (contracts/openapi.yaml `Envelope`). It only
 * documents the runtime shape; it is never instantiated.
 */
@ApiSchema({ name: 'Envelope' })
export class EnvelopeDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ description: 'The response payload' })
  data!: unknown;

  @ApiProperty({ example: 'Success' })
  message!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional({
    description: 'Per-request id, also sent as the x-correlation-id header',
  })
  correlationId?: string;
}

/**
 * The error body written by ApiExceptionFilter for every failure
 * (contracts/openapi.yaml `Error`).
 */
@ApiSchema({ name: 'Error' })
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];

  @ApiPropertyOptional({ description: 'HTTP reason phrase' })
  error?: string;

  @ApiProperty({ example: 'NOT_FOUND' })
  code!: string;

  @ApiProperty()
  correlationId!: string;

  @ApiPropertyOptional({
    description: 'Validation messages per request field (VALIDATION_FAILED)',
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  fields?: Record<string, string[]>;
}

type EnvelopedData =
  | { model: Type<unknown> }
  | { arrayOf: Type<unknown> }
  | { pageOf: Type<unknown> };

const dataSchema = (data: EnvelopedData) => {
  if ('model' in data) return { $ref: getSchemaPath(data.model) };
  if ('arrayOf' in data) {
    return { type: 'array', items: { $ref: getSchemaPath(data.arrayOf) } };
  }
  return {
    type: 'object',
    required: ['data', 'total', 'page', 'limit'],
    properties: {
      data: { type: 'array', items: { $ref: getSchemaPath(data.pageOf) } },
      total: { type: 'integer', minimum: 0 },
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1 },
    },
  };
};

/**
 * Documents a success response as `Envelope` with a typed `data`, the way
 * contracts/openapi.yaml composes it (`allOf: [Envelope, {data}]`).
 */
export const ApiEnvelopedResponse = (
  status: number,
  description: string,
  data: EnvelopedData,
) => {
  const model =
    'model' in data
      ? data.model
      : 'arrayOf' in data
        ? data.arrayOf
        : data.pageOf;
  return applyDecorators(
    ApiExtraModels(EnvelopeDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(EnvelopeDto) },
          { properties: { data: dataSchema(data) } },
        ],
      },
    }),
  );
};
