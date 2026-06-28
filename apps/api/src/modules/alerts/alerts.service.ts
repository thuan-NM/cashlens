import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../../common/types/request-user.type';
import { AlertsRepository } from './alerts.repository';
import {
  defaultAlertSettings,
  toAlertResponse,
  toAlertSettingResponse,
  toCreateAlertInput,
} from './alerts.mapper';
import { CreateAlertDto } from './dto/create-alert.dto';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';

@Injectable()
export class AlertsService {
  constructor(private readonly alertsRepository: AlertsRepository) {}

  async list(user: RequestUser, query: ListAlertsDto) {
    const result = await this.alertsRepository.listByUser(user.id, query);

    return {
      ...result,
      data: result.data.map(toAlertResponse),
    };
  }

  async create(user: RequestUser, dto: CreateAlertDto) {
    const alert = await this.alertsRepository.create(
      toCreateAlertInput(user.id, dto),
    );
    return toAlertResponse(alert);
  }

  async markRead(user: RequestUser, id: string) {
    const alert = await this.alertsRepository.findByIdForUser(user.id, id);

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    return toAlertResponse(await this.alertsRepository.markRead(id));
  }

  async markAllRead(user: RequestUser) {
    const result = await this.alertsRepository.markAllRead(user.id);
    return { count: result.count };
  }

  async settings(user: RequestUser) {
    await this.alertsRepository.createManySettings(
      defaultAlertSettings(user.id),
    );
    const settings = await this.alertsRepository.listSettings(user.id);
    return settings.map(toAlertSettingResponse);
  }

  async updateSetting(user: RequestUser, dto: UpdateAlertSettingDto) {
    const setting = await this.alertsRepository.upsertSetting(user.id, dto);
    return toAlertSettingResponse(setting);
  }
}
