import './support/synthetic-env'; // must stay first: seeds config before AppModule loads
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type Envelope<T> = {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
};

// Readiness depends only on PrismaService.$queryRaw, so a stub lets this suite
// prove the live/ready split without a running PostgreSQL (OPS-004, ERR-004).
const prismaStub = {
  $queryRaw: jest.fn(),
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  onModuleInit: jest.fn().mockResolvedValue(undefined),
  onModuleDestroy: jest.fn().mockResolvedValue(undefined),
};

describe('Health endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    prismaStub.$queryRaw.mockReset();
  });

  it('GET /api/health/live answers 200 without authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200);

    expect((response.body as Envelope<unknown>).success).toBe(true);
    expect((response.body as Envelope<unknown>).data).toEqual({ status: 'ok' });
    expect(prismaStub.$queryRaw).not.toHaveBeenCalled();
  });

  it('GET /api/health/ready answers 200 when the database is usable', async () => {
    prismaStub.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const response = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);

    expect((response.body as Envelope<unknown>).data).toEqual({
      status: 'ready',
      database: 'up',
    });
  });

  it('readiness returns 503 during a database outage while liveness stays 200', async () => {
    prismaStub.$queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED leak-canary-host:5432'),
    );

    const ready = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    expect(JSON.stringify(ready.body)).not.toContain('leak-canary');

    await request(app.getHttpServer()).get('/api/health/live').expect(200);
  });
});
