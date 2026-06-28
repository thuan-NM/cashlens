import { Alert, AlertSetting, AlertType, Prisma } from '@prisma/client';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : Number(value.toString());

export const toAlertResponse = (alert: Alert) => ({
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
});

export const toAlertSettingResponse = (setting: AlertSetting) => ({
  id: setting.id,
  userId: setting.userId,
  type: setting.type,
  inAppEnabled: setting.inAppEnabled,
  emailEnabled: setting.emailEnabled,
  threshold: decimalToNumber(setting.threshold),
  metadata: setting.metadata,
  createdAt: setting.createdAt.toISOString(),
  updatedAt: setting.updatedAt.toISOString(),
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

export const defaultAlertSettings = (userId: string) =>
  Object.values(AlertType).map((type) => ({
    userId,
    type,
    inAppEnabled: true,
    emailEnabled:
      type === AlertType.BUDGET_THRESHOLD ||
      type === AlertType.LARGE_TRANSACTION,
  }));
