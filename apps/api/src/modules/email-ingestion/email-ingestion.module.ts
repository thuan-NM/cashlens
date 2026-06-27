import { Module } from '@nestjs/common';
import { EmailConnectionsModule } from '../email-connections/email-connections.module';
import { ParserModule } from '../parser/parser.module';
import { EmailIngestionController } from './email-ingestion.controller';
import { EmailIngestionRepository } from './email-ingestion.repository';
import { EmailIngestionService } from './email-ingestion.service';
import { GmailApiService } from './gmail-api.service';

@Module({
  imports: [EmailConnectionsModule, ParserModule],
  controllers: [EmailIngestionController],
  providers: [
    EmailIngestionRepository,
    EmailIngestionService,
    GmailApiService,
  ],
})
export class EmailIngestionModule {}
