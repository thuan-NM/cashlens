import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';

@Module({
  controllers: [AlertsController],
  providers: [AlertsRepository, AlertsService],
  exports: [AlertsRepository, AlertsService],
})
export class AlertsModule {}
