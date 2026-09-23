import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

/**
 * Records graceful shutdown (OPS-005). It runs after `app.enableShutdownHooks()`
 * has closed the application, including the Prisma disconnect, so operators can
 * tell a clean SIGTERM stop from a forced kill.
 */
@Injectable()
export class ShutdownLogger implements OnApplicationShutdown {
  private readonly logger = new Logger('Lifecycle');

  onApplicationShutdown(signal?: string) {
    this.logger.log(
      `Application shut down gracefully${signal ? ` (signal ${signal})` : ''}`,
    );
  }
}
