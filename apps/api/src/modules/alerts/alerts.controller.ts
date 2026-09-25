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
import { ApiEnvelopedResponse } from '../../common/swagger/api-envelope';
import type { RequestUser } from '../../common/types/request-user.type';
import { AlertsService } from './alerts.service';
import { AlertResponseDto } from './dto/alert.response';
import { CreateAlertDto } from './dto/create-alert.dto';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @ApiEnvelopedResponse(200, 'Owner alerts, paginated', {
    pageOf: AlertResponseDto,
  })
  list(@CurrentUser() user: RequestUser, @Query() query: ListAlertsDto) {
    return this.alertsService.list(user, query);
  }

  /** ALERT-004: unread alerts, whatever their lifecycle status. */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: RequestUser) {
    return this.alertsService.unreadCount(user);
  }

  @Post()
  @ApiEnvelopedResponse(201, 'User-authored alert', {
    model: AlertResponseDto,
  })
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
  @ApiEnvelopedResponse(200, 'Owned alert marked read', {
    model: AlertResponseDto,
  })
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.alertsService.markRead(user, id);
  }

  /** ACTIVE -> DISMISSED, marking it read; 409 when resolved (ALERT-010). */
  @Patch(':id/dismiss')
  @ApiEnvelopedResponse(200, 'Owned alert dismissed', {
    model: AlertResponseDto,
  })
  dismiss(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.alertsService.dismiss(user, id);
  }
}
