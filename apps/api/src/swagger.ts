import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  getSchemaPath,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { EnvelopeDto, ErrorResponseDto } from './common/swagger/api-envelope';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('CashLens API')
    .setDescription('The CashLens API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('accessToken')
    // Every failure uses the filter's error body (ApiExceptionFilter).
    .addGlobalResponse({
      status: 'default',
      description:
        'Error (code, message, correlationId, and fields on validation errors)',
      schema: { $ref: getSchemaPath(ErrorResponseDto) },
    })
    .build();

  return SwaggerModule.createDocument(app, config, {
    extraModels: [EnvelopeDto, ErrorResponseDto],
  });
}

export function setupSwagger(app: INestApplication): void {
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    yamlDocumentUrl: 'api/docs-yaml',
  });
}
