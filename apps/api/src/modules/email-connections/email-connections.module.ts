import { Module } from '@nestjs/common';
import { EmailConnectionsController } from './email-connections.controller';
import { EmailConnectionsRepository } from './email-connections.repository';
import { EmailConnectionsService } from './email-connections.service';
import { GmailOAuthService } from './gmail-oauth.service';

@Module({
  controllers: [EmailConnectionsController],
  providers: [
    EmailConnectionsRepository,
    EmailConnectionsService,
    GmailOAuthService,
  ],
  exports: [EmailConnectionsService, GmailOAuthService],
})
export class EmailConnectionsModule {}
