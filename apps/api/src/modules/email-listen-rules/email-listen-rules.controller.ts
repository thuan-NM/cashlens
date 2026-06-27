import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateEmailListenRuleDto } from './dto/create-email-listen-rule.dto';
import { UpdateEmailListenRuleDto } from './dto/update-email-listen-rule.dto';
import { EmailListenRulesService } from './email-listen-rules.service';

@Controller('email-listen-rules')
@UseGuards(JwtAuthGuard)
export class EmailListenRulesController {
  constructor(private readonly service: EmailListenRulesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateEmailListenRuleDto,
  ) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmailListenRuleDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
