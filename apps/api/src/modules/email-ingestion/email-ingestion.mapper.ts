import { EmailMessage, EmailSyncRun } from '@prisma/client';
import { EmailSyncRunResponseDto } from './dto/email-sync-run.response';

export const toEmailMessageResponse = (message: EmailMessage) => ({
  ...message,
  receivedAt: message.receivedAt.toISOString(),
  createdAt: message.createdAt.toISOString(),
  updatedAt: message.updatedAt.toISOString(),
});

/**
 * The contract's EmailSyncRun (T044). The lease token and the opaque provider
 * cursors stay internal.
 */
export const toEmailSyncRunResponse = (
  run: EmailSyncRun,
): EmailSyncRunResponseDto => ({
  id: run.id,
  emailConnectionId: run.emailConnectionId,
  triggerType: run.triggerType,
  status: run.status,
  startedAt: run.startedAt.toISOString(),
  finishedAt: run.finishedAt?.toISOString() ?? null,
  createdAt: run.createdAt.toISOString(),
  emailsFound: run.emailsFound,
  emailsMatched: run.emailsMatched,
  emailsParsed: run.emailsParsed,
  transactionsCreated: run.transactionsCreated,
  emailsFailed: run.emailsFailed,
  hasMore: run.hasMore,
  errorMessage: run.errorMessage,
});
