import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { EmailConnectionsService } from './email-connections.service';

@Controller('email-connections')
export class EmailConnectionsController {
  constructor(private readonly service: EmailConnectionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('gmail/connect')
  connectGmail(@CurrentUser() user: RequestUser) {
    return this.service.connectGmail(user);
  }

  @Get('gmail/callback')
  callback(@Query('code') code: string, @Query('state') state: string) {
    return this.service.completeGmail(code, state);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  disconnect(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.disconnect(user, id);
  }
}
