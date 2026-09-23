import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthController, READINESS_TIMEOUT_MS } from './health.controller';

const prismaStub = (queryRaw: jest.Mock) =>
  ({ $queryRaw: queryRaw }) as unknown as PrismaService;

describe('HealthController', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports liveness without touching the database', () => {
    const queryRaw = jest.fn();
    const controller = new HealthController(prismaStub(queryRaw));

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports ready when the database answers', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);
    const controller = new HealthController(prismaStub(queryRaw));

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      database: 'up',
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 503 without leaking database error details', async () => {
    const queryRaw = jest
      .fn()
      .mockRejectedValue(
        new Error('password authentication failed for user "leak-canary"'),
      );
    const controller = new HealthController(prismaStub(queryRaw));

    const outcome = controller.ready();

    await expect(outcome).rejects.toBeInstanceOf(ServiceUnavailableException);
    const error = (await outcome.catch((e: unknown) => e)) as
      | ServiceUnavailableException
      | undefined;
    expect(error?.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(error?.getResponse())).not.toContain('leak-canary');
  });

  it('returns 503 when the database does not answer in time', async () => {
    jest.useFakeTimers();
    const queryRaw = jest.fn().mockReturnValue(new Promise(() => undefined));
    const controller = new HealthController(prismaStub(queryRaw));

    const outcome = controller.ready();
    const assertion = expect(outcome).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
    await assertion;
  });
});
