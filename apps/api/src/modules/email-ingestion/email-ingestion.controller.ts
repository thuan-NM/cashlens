import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiEnvelopedResponse } from '../../common/swagger/api-envelope';
import type { RequestUser } from '../../common/types/request-user.type';
import { EmailSyncRunResponseDto } from './dto/email-sync-run.response';
import { ListEmailMessagesDto } from './dto/list-email-messages.dto';
import { EmailIngestionService } from './email-ingestion.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class EmailIngestionController {
  constructor(private readonly service: EmailIngestionService) {}

  @Post('email-connections/:id/sync')
  @ApiEnvelopedResponse(201, 'Terminal or continuable run result', {
    model: EmailSyncRunResponseDto,
  })
  sync(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.sync(user, id);
  }

  @Get('email-connections/:id/sync-runs')
  @ApiEnvelopedResponse(200, 'Owner-visible sync runs, newest first', {
    arrayOf: EmailSyncRunResponseDto,
  })
  listRuns(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.listRuns(user, id);
  }

  @Get('email-messages')
  listMessages(
    @CurrentUser() user: RequestUser,
    @Query() query: ListEmailMessagesDto,
  ) {
    return this.service.listMessages(user, query);
  }
}
