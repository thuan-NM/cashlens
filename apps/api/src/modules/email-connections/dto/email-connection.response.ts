import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { EmailConnectionStatus, EmailProvider } from '@prisma/client';
import {
  RECOVERY_ACTIONS,
  type RecoveryAction,
} from '../email-connections.mapper';

/**
 * OpenAPI description of `toEmailConnectionResponse` (its declared return
 * type). Credentials, the provider cursor, and the lease token are never
 * part of it.
 */
@ApiSchema({ name: 'EmailConnection' })
export class EmailConnectionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: EmailProvider, enumName: 'EmailProvider' })
  provider!: EmailProvider;

  @ApiProperty()
  emailAddress!: string;

  @ApiProperty({ type: String, nullable: true })
  providerUserId!: string | null;

  @ApiProperty({ format: 'date-time' })
  tokenExpiresAt!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiProperty({
    enum: EmailConnectionStatus,
    enumName: 'EmailConnectionStatus',
  })
  status!: EmailConnectionStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSyncedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  connectedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  disconnectedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty()
  reconnectRequired!: boolean;

  @ApiProperty({ enum: RECOVERY_ACTIONS })
  recoveryAction!: RecoveryAction;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastFailedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  backfillFrom!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  backfillCompletedAt!: string | null;

  @ApiProperty({ description: 'True while an unexpired sync lease exists' })
  syncInProgress!: boolean;
}
