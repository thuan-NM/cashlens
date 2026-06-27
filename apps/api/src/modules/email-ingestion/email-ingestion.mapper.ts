import { EmailMessage, EmailSyncRun } from '@prisma/client';

export const toEmailMessageResponse = (message: EmailMessage) => ({
  ...message,
  receivedAt: message.receivedAt.toISOString(),
  createdAt: message.createdAt.toISOString(),
  updatedAt: message.updatedAt.toISOString(),
});

export const toEmailSyncRunResponse = (run: EmailSyncRun) => ({
  ...run,
  startedAt: run.startedAt.toISOString(),
  finishedAt: run.finishedAt?.toISOString() ?? null,
  createdAt: run.createdAt.toISOString(),
});
