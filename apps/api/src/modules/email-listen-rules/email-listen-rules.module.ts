import { Module } from '@nestjs/common';
import { EmailListenRulesController } from './email-listen-rules.controller';
import { EmailListenRulesRepository } from './email-listen-rules.repository';
import { EmailListenRulesService } from './email-listen-rules.service';

@Module({
  controllers: [EmailListenRulesController],
  providers: [EmailListenRulesRepository, EmailListenRulesService],
  exports: [EmailListenRulesRepository],
})
export class EmailListenRulesModule {}
