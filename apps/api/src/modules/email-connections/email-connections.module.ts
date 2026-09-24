import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { UsersModule } from '../users/users.module';
import { EmailConnectionsController } from './email-connections.controller';
import { EmailConnectionsRepository } from './email-connections.repository';
import { EmailConnectionsService } from './email-connections.service';
import { GmailOAuthService } from './gmail-oauth.service';

@Module({
  imports: [UsersModule, AlertsModule],
  controllers: [EmailConnectionsController],
  providers: [
    EmailConnectionsRepository,
    EmailConnectionsService,
    GmailOAuthService,
  ],
  exports: [EmailConnectionsService, GmailOAuthService],
})
export class EmailConnectionsModule {}
