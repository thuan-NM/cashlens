import { Injectable } from '@nestjs/common';
import { EmailConnectionStatus, EmailSyncStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ListEmailMessagesDto } from './dto/list-email-messages.dto';
import { buildEmailMessageWhere } from './query/email-messages.query';
import { SYNC_POLICY } from './sync-policy';

/** A run that stopped without finishing inside its lease (T042). */
export const EXPIRED_RUN_MESSAGE =
  'The sync stopped before finishing; its progress was not saved';

export type SyncRunOutcome = {
  status: EmailSyncStatus;
  emailsFound: number;
  emailsMatched: number;
  emailsParsed: number;
  emailsFailed: number;
  transactionsCreated: number;
  hasMore: boolean;
  errorMessage: string | null;
  cursorAfter: string | null;
};

export type SyncConnectionOutcome = {
  status: EmailConnectionStatus;
  errorMessage: string | null;
  syncCursor?: string;
  backfillFrom?: Date;
  backfillCompletedAt?: Date;
  lastSyncedAt?: Date;
  lastFailedAt?: Date;
};

@Injectable()
export class EmailIngestionRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  enabledRules(userId: string, connectionId: string) {
    return this.prisma.emailListenRule.findMany({
      where: {
        userId,
        isEnabled: true,
        OR: [{ emailConnectionId: null }, { emailConnectionId: connectionId }],
      },
      orderBy: { priority: 'asc' },
    });
  }

  /** The provider-message layer (EMAIL-008): what this message already became. */
  findMessageByProvider(emailConnectionId: string, providerMessageId: string) {
    return this.prisma.emailMessage.findUnique({
      where: {
        emailConnectionId_providerMessageId: {
          emailConnectionId,
          providerMessageId,
        },
      },
      select: {
        id: true,
        processingStatus: true,
        transaction: { select: { id: true } },
      },
    });
  }

  /**
   * Takes the connection's sync lease atomically (EMAIL-007, T042); null when
   * another run holds an unexpired lease. Under PostgreSQL row locking a
   * concurrent attempt waits, re-checks the predicate, and matches nothing.
   * Any run still RUNNING lost its lease and is recorded as EXPIRED. The
   * cursor is read here, under the lease, never from an earlier snapshot.
   */
  acquireLease(userId: string, connectionId: string, now: Date) {
    const token = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.emailConnection.updateMany({
        where: {
          id: connectionId,
          userId,
          disconnectedAt: null,
          OR: [
            { syncLeaseExpiresAt: null },
            { syncLeaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          syncLeaseToken: token,
          syncLeaseExpiresAt: new Date(now.getTime() + SYNC_POLICY.leaseTtlMs),
        },
      });
      if (!count) return null;

      await tx.emailSyncRun.updateMany({
        where: { emailConnectionId: connectionId, status: 'RUNNING' },
        data: {
          status: 'EXPIRED',
          finishedAt: now,
          hasMore: false,
          errorMessage: EXPIRED_RUN_MESSAGE,
        },
      });
      const connection = await tx.emailConnection.findUniqueOrThrow({
        where: { id: connectionId },
        select: {
          syncCursor: true,
          backfillFrom: true,
          backfillCompletedAt: true,
        },
      });
      const run = await tx.emailSyncRun.create({
        data: {
          emailConnectionId: connectionId,
          triggerType: 'MANUAL',
          startedAt: now,
          leaseToken: token,
          cursorBefore: connection.syncCursor,
        },
      });
      return { token, run, connection };
    });
  }

  /**
   * The only writer of a run's outcome and of the connection's sync progress
   * (T042, T044): the cursor, backfill fields, and connection status are
   * committed, and the lease released, only while this run still holds the
   * lease. A run that lost its lease keeps its counts, is recorded EXPIRED,
   * and changes nothing on the connection.
   */
  finishRun(
    lease: { token: string; runId: string; connectionId: string },
    run: SyncRunOutcome,
    connection: SyncConnectionOutcome,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const finishedAt = new Date();
      const { count } = await tx.emailConnection.updateMany({
        where: { id: lease.connectionId, syncLeaseToken: lease.token },
        data: { ...connection, syncLeaseToken: null, syncLeaseExpiresAt: null },
      });
      // Keyed by the run's own lease token, so a run that lost its lease
      // (already recorded EXPIRED by the new holder) still keeps its counts.
      await tx.emailSyncRun.updateMany({
        where: { id: lease.runId, leaseToken: lease.token },
        data: count
          ? { ...run, finishedAt }
          : {
              ...run,
              status: 'EXPIRED',
              hasMore: false,
              cursorAfter: null,
              errorMessage: EXPIRED_RUN_MESSAGE,
              finishedAt,
            },
      });
      return tx.emailSyncRun.findUniqueOrThrow({ where: { id: lease.runId } });
    });
  }

  /**
   * Gives up a message after the attempt limit (T044): a still-PENDING row
   * becomes FAILED with a sanitized code, so later syncs skip it.
   */
  markMessageFailed(emailConnectionId: string, providerMessageId: string) {
    return this.prisma.emailMessage.updateMany({
      where: {
        emailConnectionId,
        providerMessageId,
        processingStatus: 'PENDING',
      },
      data: { processingStatus: 'FAILED', errorMessage: 'PROCESSING_FAILED' },
    });
  }

  listRuns(emailConnectionId: string) {
    return this.prisma.emailSyncRun.findMany({
      where: { emailConnectionId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Message metadata only: no body or snippet is stored (EMAIL-012), and a
   * legacy snippet is cleared when the message is seen again.
   */
  upsertMessage(
    data: Omit<Prisma.EmailMessageUncheckedCreateInput, 'snippet'>,
  ) {
    return this.prisma.emailMessage.upsert({
      where: {
        emailConnectionId_providerMessageId: {
          emailConnectionId: data.emailConnectionId,
          providerMessageId: data.providerMessageId,
        },
      },
      create: data,
      update: {
        providerThreadId: data.providerThreadId,
        providerHistoryId: data.providerHistoryId,
        messageIdHeader: data.messageIdHeader,
        senderEmail: data.senderEmail,
        senderName: data.senderName,
        subject: data.subject,
        snippet: null,
        receivedAt: data.receivedAt,
        bodyHash: data.bodyHash,
        matchedRuleId: data.matchedRuleId,
        bankProviderId: data.bankProviderId,
        errorMessage: null,
      },
    });
  }

  markRuleMatched(id: string) {
    return this.prisma.emailListenRule.update({
      where: { id },
      data: { lastMatchedAt: new Date() },
    });
  }

  async listMessages(userId: string, query: ListEmailMessagesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = buildEmailMessageWhere(userId, query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.emailMessage.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.emailMessage.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}
