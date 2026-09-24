import { Module } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { AlertsModule } from '../alerts/alerts.module';
import { BudgetsController } from './budgets.controller';
import { BudgetsRepository } from './budgets.repository';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [AlertsModule],
  controllers: [BudgetsController],
  providers: [BudgetsRepository, BudgetsService, Clock],
  exports: [BudgetsRepository, BudgetsService],
})
export class BudgetsModule {}
