import '../test/support/synthetic-env'; // first: AppModule validates configuration on import
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { createOpenApiDocument } from './swagger';

/**
 * Regression guard for the OpenAPI response schemas (T101 follow-up): the
 * contract's Envelope, Error, EmailSyncRun, GoalFeasibility, and Alert must
 * stay described, and the routes that return them must reference them the
 * way contracts/openapi.yaml composes them (`allOf: [Envelope, {data}]`).
 */
type Schema = {
  required?: string[];
  properties?: Record<string, Schema>;
  allOf?: Schema[];
  items?: Schema;
  $ref?: string;
};

const ref = (name: string) => `#/components/schemas/${name}`;
const REQUIRED: Record<string, string[]> = {
  Envelope: ['success', 'data', 'message', 'timestamp'],
  Error: ['statusCode', 'message', 'code', 'correlationId'],
  EmailSyncRun: [
    'id',
    'emailConnectionId',
    'triggerType',
    'status',
    'startedAt',
    'emailsFound',
    'emailsMatched',
    'emailsParsed',
    'transactionsCreated',
    'emailsFailed',
    'hasMore',
  ],
  GoalFeasibility: [
    'goalId',
    'months',
    'horizonSource',
    'pastDeadline',
    'targetAmount',
    'savedAmount',
    'remainingAmount',
    'monthlyRequired',
    'feasibilityScore',
    'status',
    'observationMonths',
  ],
  Alert: [
    'id',
    'type',
    'severity',
    'title',
    'message',
    'isRead',
    'status',
    'triggeredAt',
    'createdAt',
  ],
  AlertDelivery: ['channel', 'status', 'attemptCount'],
  // Consumed by apps/web through @repo/api-contract (refactor wave 1).
  AlertSetting: [
    'id',
    'type',
    'inAppEnabled',
    'emailEnabled',
    'emailAvailable',
  ],
  EmailConnection: [
    'id',
    'provider',
    'emailAddress',
    'status',
    'recoveryAction',
    'reconnectRequired',
    'syncInProgress',
  ],
  Goal: [
    'id',
    'name',
    'targetAmount',
    'savedAmount',
    'remainingAmount',
    'currency',
    'status',
  ],
};

const enveloped = (
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'post' | 'patch',
  status: string,
): Schema => {
  const response = (
    document.paths[path]?.[method]?.responses as Record<
      string,
      { content?: Record<string, { schema: Schema }> }
    >
  )?.[status];
  const schema = response?.content?.['application/json']?.schema;
  expect(schema?.allOf?.[0]?.$ref).toBe(ref('Envelope'));
  return schema?.allOf?.[1]?.properties?.data ?? {};
};

describe('OpenAPI response schemas', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    document = createOpenApiDocument(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(Object.entries(REQUIRED))(
    'describes %s with its required fields',
    (name, required) => {
      const schema = document.components?.schemas?.[name] as Schema;
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(expect.arrayContaining(required));
    },
  );

  it('envelopes the sync, simulation, and alert responses with their models', () => {
    expect(
      enveloped(document, '/api/email-connections/{id}/sync', 'post', '201')
        .$ref,
    ).toBe(ref('EmailSyncRun'));
    expect(
      enveloped(document, '/api/email-connections/{id}/sync-runs', 'get', '200')
        .items?.$ref,
    ).toBe(ref('EmailSyncRun'));
    expect(
      enveloped(document, '/api/goals/{id}/simulation', 'get', '200').$ref,
    ).toBe(ref('GoalFeasibility'));
    expect(
      enveloped(document, '/api/alerts', 'get', '200').properties?.data?.items
        ?.$ref,
    ).toBe(ref('Alert'));
    expect(
      enveloped(document, '/api/alerts/{id}/dismiss', 'patch', '200').$ref,
    ).toBe(ref('Alert'));
  });

  it('documents the Error body as the default response of every operation', () => {
    const operations = Object.values(document.paths).flatMap((item) =>
      Object.values(item as Record<string, { responses?: object }>),
    );
    expect(operations.length).toBeGreaterThan(50);
    for (const operation of operations) {
      expect(
        (operation.responses as Record<string, { content?: object }>)?.default
          ?.content,
      ).toEqual({ 'application/json': { schema: { $ref: ref('Error') } } });
    }
  });
});

describe('committed docs/swagger.json', () => {
  // Regenerate with `yarn workspace api swagger:generate` after DTO changes.
  const committed = JSON.parse(
    readFileSync(join(__dirname, '..', 'docs', 'swagger.json'), 'utf8'),
  ) as OpenAPIObject;
  const schemas = committed.components?.schemas as Record<string, Schema>;

  it('contains every contract response schema', () => {
    for (const name of Object.keys(REQUIRED)) {
      expect(schemas[name]?.required).toEqual(
        expect.arrayContaining(REQUIRED[name]),
      );
    }
  });

  it('describes the BudgetWrite and UserSettingsWrite request bodies', () => {
    expect(Object.keys(schemas.UpdateBudgetDto?.properties ?? {})).toContain(
      'thresholdPercent',
    );
    expect(
      Object.keys(schemas.UpdateUserSettingsDto?.properties ?? {}),
    ).toContain('storeRawEmailBody');
  });
});
