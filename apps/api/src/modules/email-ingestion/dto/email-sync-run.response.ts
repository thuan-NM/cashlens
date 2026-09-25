import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { EmailSyncStatus, EmailSyncTriggerType } from '@prisma/client';

/**
 * OpenAPI description of `toEmailSyncRunResponse` (contracts/openapi.yaml
 * `EmailSyncRun`). Documentation only; the mapper defines the runtime shape.
 */
@ApiSchema({ name: 'EmailSyncRun' })
export class EmailSyncRunResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  emailConnectionId!: string;

  @ApiProperty({ enum: EmailSyncTriggerType, enumName: 'EmailSyncTriggerType' })
  triggerType!: EmailSyncTriggerType;

  @ApiProperty({ enum: EmailSyncStatus, enumName: 'EmailSyncStatus' })
  status!: EmailSyncStatus;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ minimum: 0 })
  emailsFound!: number;

  @ApiProperty({ minimum: 0 })
  emailsMatched!: number;

  @ApiProperty({ minimum: 0 })
  emailsParsed!: number;

  @ApiProperty({ minimum: 0 })
  transactionsCreated!: number;

  @ApiProperty({ minimum: 0 })
  emailsFailed!: number;

  @ApiProperty({
    description:
      'True when a non-FAILED run left work in the current window; the next manual sync continues it',
  })
  hasMore!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Sanitized failure summary',
  })
  errorMessage!: string | null;
}
