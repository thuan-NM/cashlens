import { Module } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { AlertsModule } from '../alerts/alerts.module';
import { GoalsController } from './goals.controller';
import { GoalsRepository } from './goals.repository';
import { GoalsService } from './goals.service';

@Module({
  imports: [AlertsModule],
  controllers: [GoalsController],
  providers: [GoalsRepository, GoalsService, Clock],
  exports: [GoalsRepository, GoalsService],
})
export class GoalsModule {}
