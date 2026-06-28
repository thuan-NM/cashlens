import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestUser } from '../../common/types/request-user.type';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: ListAlertsDto) {
    return this.alertsService.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAlertDto) {
    return this.alertsService.create(user, dto);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.alertsService.markAllRead(user);
  }

  @Get('settings')
  settings(@CurrentUser() user: RequestUser) {
    return this.alertsService.settings(user);
  }

  @Patch('settings')
  updateSetting(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateAlertSettingDto,
  ) {
    return this.alertsService.updateSetting(user, dto);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.alertsService.markRead(user, id);
  }
}
