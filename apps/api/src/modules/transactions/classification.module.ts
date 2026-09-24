import { Module } from '@nestjs/common';
import { ClassificationRulesController } from './classification-rules.controller';
import { ClassificationRepository } from './classification.repository';
import { ClassificationService } from './classification.service';

/**
 * Deterministic classification (US4). Shared by manual transactions and the
 * email import, which both classify new rows inside their own transaction.
 */
@Module({
  controllers: [ClassificationRulesController],
  providers: [ClassificationRepository, ClassificationService],
  exports: [ClassificationService],
})
export class ClassificationModule {}
