import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ShutdownLogger } from './shutdown-logger';

@Module({
  controllers: [HealthController],
  providers: [ShutdownLogger],
})
export class HealthModule {}
