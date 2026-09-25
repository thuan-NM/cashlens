import {
  Alert,
  AlertDelivery,
  AlertSetting,
  AlertType,
  Prisma,
} from '@prisma/client';
import {
  AlertDeliveryResponseDto,
  AlertResponseDto,
  AlertSettingResponseDto,
} from './dto/alert.response';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : Number(value.toString());

const iso = (value: Date | null) => value?.toISOString() ?? null;

/** The email outcome (ALERT-005, ALERT-006); sanitized fields only. */
export const toAlertDeliveryResponse = (
  delivery: AlertDelivery,
): AlertDeliveryResponseDto => ({
  channel: delivery.channel,
  status: delivery.status,
  skipReason: delivery.skipReason,
  attemptCount: delivery.attemptCount,
  lastAttemptAt: iso(delivery.lastAttemptAt),
  sentAt: iso(delivery.sentAt),
  failureCode: delivery.failureCode,
});

/**
 * Existing fields plus the DB-M4 lifecycle. `emailDelivery` is null when the
 * alert has no delivery row: legacy and user-authored alerts (ALERT-011).
 */
export const toAlertResponse = (
  alert: Alert & { deliveries?: AlertDelivery[] },
): AlertResponseDto => ({
  id: alert.id,
  userId: alert.userId,
  type: alert.type,
  severity: alert.severity,
  title: alert.title,
  message: alert.message,
  resourceType: alert.resourceType,
  resourceId: alert.resourceId,
  isRead: alert.isRead,
  readAt: alert.readAt?.toISOString() ?? null,
  metadata: alert.metadata,
  createdAt: alert.createdAt.toISOString(),
  status: alert.status,
  conditionKey: alert.conditionKey,
  thresholdValue: decimalToNumber(alert.thresholdValue),
  observedValue: decimalToNumber(alert.observedValue),
  periodStart: iso(alert.periodStart),
  periodEnd: iso(alert.periodEnd),
  triggeredAt: alert.triggeredAt.toISOString(),
  resolvedAt: iso(alert.resolvedAt),
  resolutionReason: alert.resolutionReason,
  dismissedAt: iso(alert.dismissedAt),
  emailDelivery: (() => {
    const email = alert.deliveries?.find(
      (delivery) => delivery.channel === 'EMAIL',
    );
    return email ? toAlertDeliveryResponse(email) : null;
  })(),
});

export const toAlertSettingResponse = (
  setting: AlertSetting,
  emailAvailable: boolean,
): AlertSettingResponseDto => ({
  id: setting.id,
  userId: setting.userId,
  type: setting.type,
  inAppEnabled: setting.inAppEnabled,
  emailEnabled: setting.emailEnabled,
  threshold: decimalToNumber(setting.threshold),
  metadata: setting.metadata,
  createdAt: setting.createdAt.toISOString(),
  updatedAt: setting.updatedAt.toISOString(),
  emailAvailable,
});

export const toCreateAlertInput = (
  userId: string,
  dto: CreateAlertDto,
): Prisma.AlertUncheckedCreateInput => ({
  userId,
  type: dto.type,
  severity: dto.severity,
  title: dto.title,
  message: dto.message,
  resourceType: dto.resourceType,
  resourceId: dto.resourceId,
  metadata: dto.metadata,
  // User-authored: no condition identity, never evaluated (ALERT-011).
  conditionKey: null,
});

export const toUpsertAlertSettingInput = (
  userId: string,
  dto: UpdateAlertSettingDto,
): Prisma.AlertSettingUncheckedCreateInput => ({
  userId,
  type: dto.type,
  inAppEnabled: dto.inAppEnabled ?? true,
  emailEnabled: dto.emailEnabled ?? false,
  threshold: dto.threshold,
  metadata: dto.metadata,
});

/**
 * Settings created for an account that has none (ALERT-005): in-app on and
 * email off for every type. Existing rows are never rewritten (I2).
 */
export const defaultAlertSettings = (userId: string) =>
  Object.values(AlertType).map((type) => ({
    userId,
    type,
    inAppEnabled: true,
    emailEnabled: false,
  }));
