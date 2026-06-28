import { Module } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsRepository } from './goals.repository';
import { GoalsService } from './goals.service';

@Module({
  controllers: [GoalsController],
  providers: [GoalsRepository, GoalsService],
  exports: [GoalsRepository, GoalsService],
})
export class GoalsModule {}
