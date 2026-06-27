import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { ListEmailMessagesDto } from './dto/list-email-messages.dto';
import { EmailIngestionService } from './email-ingestion.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class EmailIngestionController {
  constructor(private readonly service: EmailIngestionService) {}

  @Post('email-connections/:id/sync')
  sync(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.sync(user, id);
  }

  @Get('email-connections/:id/sync-runs')
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
