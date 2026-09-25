import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  AlertDeliveryChannel,
  AlertDeliveryStatus,
  AlertSeverity,
  AlertStatus,
  AlertType,
  Prisma,
} from '@prisma/client';

/**
 * OpenAPI description of `toAlertDeliveryResponse` (contracts/openapi.yaml
 * `AlertDelivery`). Documentation only.
 */
@ApiSchema({ name: 'AlertDelivery' })
export class AlertDeliveryResponseDto {
  @ApiProperty({ enum: AlertDeliveryChannel, enumName: 'AlertDeliveryChannel' })
  channel!: AlertDeliveryChannel;

  @ApiProperty({ enum: AlertDeliveryStatus, enumName: 'AlertDeliveryStatus' })
  status!: AlertDeliveryStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'NOT_CRITICAL',
      'EMAIL_DISABLED',
      'NOTIFICATIONS_DISABLED',
      'TRANSPORT_DISABLED',
    ],
  })
  skipReason!: string | null;

  @ApiProperty({ minimum: 0, maximum: 3 })
  attemptCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastAttemptAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sentAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'For example TIMEOUT, AUTH, REJECTED, INTERRUPTED',
  })
  failureCode!: string | null;
}

/**
 * OpenAPI description of `toAlertResponse` (contracts/openapi.yaml `Alert`):
 * the lifecycle `status` is independent of the read state. Documentation only.
 */
@ApiSchema({ name: 'Alert' })
export class AlertResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: AlertType, enumName: 'AlertType' })
  type!: AlertType;

  @ApiProperty({ enum: AlertSeverity, enumName: 'AlertSeverity' })
  severity!: AlertSeverity;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: String, nullable: true })
  resourceType!: string | null;

  @ApiProperty({ type: String, nullable: true })
  resourceId!: string | null;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Prisma.JsonValue;

  @ApiProperty({ enum: AlertStatus, enumName: 'AlertStatus' })
  status!: AlertStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'null for legacy and user-authored alerts',
  })
  conditionKey!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  thresholdValue!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  observedValue!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  periodStart!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  periodEnd!: string | null;

  @ApiProperty({ format: 'date-time' })
  triggeredAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  resolutionReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dismissedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: AlertDeliveryResponseDto,
    nullable: true,
    description: 'null for legacy and user-authored alerts (no delivery row)',
  })
  emailDelivery!: AlertDeliveryResponseDto | null;
}

/**
 * OpenAPI description of `toAlertSettingResponse` (contracts/openapi.yaml
 * `AlertSetting`). Documentation only.
 */
@ApiSchema({ name: 'AlertSetting' })
export class AlertSettingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: AlertType, enumName: 'AlertType' })
  type!: AlertType;

  @ApiProperty()
  inAppEnabled!: boolean;

  @ApiProperty()
  emailEnabled!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  threshold!: number | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Prisma.JsonValue;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({
    description: 'false when the deployment runs with email delivery disabled',
  })
  emailAvailable!: boolean;
}
