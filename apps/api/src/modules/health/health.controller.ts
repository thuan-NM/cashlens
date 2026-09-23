import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Upper bound for the readiness database probe, so a hung database cannot hang health checks. */
export const READINESS_TIMEOUT_MS = 2000;

/**
 * Liveness reports only that the process is serving requests; readiness also
 * requires PostgreSQL (OPS-004). Neither endpoint requires authentication, and
 * failures never expose dependency error details (ERR-004).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  async ready() {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS);
    } catch {
      throw new ServiceUnavailableException('Service is not ready');
    }
    return { status: 'ready' as const, database: 'up' as const };
  }
}

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('readiness probe timed out')),
      timeoutMs,
    );
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
