import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import type { RequestUser } from '../../common/types/request-user.type';
import { AlertsRepository } from './alerts.repository';
import { AlertDeliveryService } from './delivery/alert-delivery.service';
import {
  defaultAlertSettings,
  toAlertResponse,
  toAlertSettingResponse,
  toCreateAlertInput,
} from './alerts.mapper';
import { CreateAlertDto } from './dto/create-alert.dto';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';

/** 409 for dismissing a resolved alert (ALERT-010: RESOLVED is terminal). */
const alertResolved = () =>
  new ConflictException({
    statusCode: 409,
    message: 'The alert is already resolved',
    error: 'Conflict',
    code: 'ALERT_RESOLVED',
  });

@Injectable()
export class AlertsService {
  constructor(
    private readonly alertsRepository: AlertsRepository,
    private readonly clock: Clock,
    private readonly delivery: AlertDeliveryService,
  ) {}

  /** Reading alerts also surfaces interrupted deliveries (ALERT-006). */
  async list(user: RequestUser, query: ListAlertsDto) {
    await this.delivery.sweepInterrupted(user.id);
    const result = await this.alertsRepository.listByUser(user.id, query);

    return {
      ...result,
      data: result.data.map(toAlertResponse),
    };
  }

  async unreadCount(user: RequestUser) {
    return { count: await this.alertsRepository.unreadCount(user.id) };
  }

  /** User-authored: no condition key, no delivery row (ALERT-011). */
  async create(user: RequestUser, dto: CreateAlertDto) {
    const alert = await this.alertsRepository.create(
      toCreateAlertInput(user.id, dto),
    );
    return toAlertResponse(alert);
  }

  /** Changes only the read state, never the status (ALERT-010). */
  async markRead(user: RequestUser, id: string) {
    const alert = await this.alertsRepository.findByIdForUser(user.id, id);

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    const updated = await this.alertsRepository.markRead(user.id, id);
    if (!updated) {
      throw new NotFoundException('Alert not found');
    }
    return toAlertResponse(updated);
  }

  async markAllRead(user: RequestUser) {
    const result = await this.alertsRepository.markAllRead(user.id);
    return { count: result.count };
  }

  /**
   * ACTIVE -> DISMISSED, marking it read (ALERT-010). Dismissing a DISMISSED
   * alert changes nothing; a RESOLVED one is a 409. The alert stays open, so
   * the same condition cannot re-alert until it resolves.
   */
  async dismiss(user: RequestUser, id: string) {
    const alert = await this.alertsRepository.findByIdForUser(user.id, id);
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.status === 'RESOLVED') throw alertResolved();

    if (alert.status === 'ACTIVE') {
      const changed = await this.alertsRepository.dismiss(
        user.id,
        id,
        this.clock.now(),
        alert.readAt,
      );
      if (!changed) {
        // Resolved (or dismissed) meanwhile: report what it is now.
        const current = await this.alertsRepository.findByIdForUser(
          user.id,
          id,
        );
        if (!current) throw new NotFoundException('Alert not found');
        if (current.status === 'RESOLVED') throw alertResolved();
        return toAlertResponse(current);
      }
    }
    const dismissed = await this.alertsRepository.findByIdForUser(user.id, id);
    if (!dismissed) throw new NotFoundException('Alert not found');
    return toAlertResponse(dismissed);
  }

  async settings(user: RequestUser) {
    await this.alertsRepository.createManySettings(
      defaultAlertSettings(user.id),
    );
    const settings = await this.alertsRepository.listSettings(user.id);
    const emailAvailable = this.emailAvailable();
    return settings.map((setting) =>
      toAlertSettingResponse(setting, emailAvailable),
    );
  }

  /**
   * Email for a type requires in-app for that type (ALERT-005). The rule is
   * checked on the resulting row whenever a request changes either flag; a
   * legacy row that already combines them is left alone otherwise.
   */
  async updateSetting(user: RequestUser, dto: UpdateAlertSettingDto) {
    if (dto.inAppEnabled !== undefined || dto.emailEnabled !== undefined) {
      const current = (await this.alertsRepository.listSettings(user.id)).find(
        (setting) => setting.type === dto.type,
      );
      const inAppEnabled = dto.inAppEnabled ?? current?.inAppEnabled ?? true;
      const emailEnabled = dto.emailEnabled ?? current?.emailEnabled ?? false;
      if (emailEnabled && !inAppEnabled) {
        throw new BadRequestException([
          'emailEnabled requires inAppEnabled for the same alert type',
        ]);
      }
    }
    const setting = await this.alertsRepository.upsertSetting(user.id, dto);
    return toAlertSettingResponse(setting, this.emailAvailable());
  }

  /** CFG-007: false when the deployment runs with email disabled. */
  emailAvailable() {
    return this.delivery.available;
  }
}
