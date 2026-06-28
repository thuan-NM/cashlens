import { Module } from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { BudgetsRepository } from './budgets.repository';
import { BudgetsService } from './budgets.service';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsRepository, BudgetsService],
  exports: [BudgetsRepository, BudgetsService],
})
export class BudgetsModule {}
