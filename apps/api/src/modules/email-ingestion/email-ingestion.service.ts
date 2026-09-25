import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditActorType, EmailSyncStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { RECONNECT_REQUIRED_MESSAGE } from '../email-connections/email-connections.repository';
import { EmailConnectionsService } from '../email-connections/email-connections.service';
import { ParserService } from '../parser/parser.service';
import { UsersRepository } from '../users/users.repository';
import { ListEmailMessagesDto } from './dto/list-email-messages.dto';
import {
  toEmailMessageResponse,
  toEmailSyncRunResponse,
} from './email-ingestion.mapper';
import {
  EXPIRED_RUN_MESSAGE,
  EmailIngestionRepository,
  SyncConnectionOutcome,
} from './email-ingestion.repository';
import { GmailApiError, GmailApiService } from './gmail-api.service';
import {
  SYNC_POLICY,
  SyncWindow,
  advanceCursor,
  backfillBoundary,
  hashQuery,
  parseCursor,
  planWindow,
  serializeCursor,
  windowQuery,
} from './sync-policy';

type ListenRule = Awaited<
  ReturnType<EmailIngestionRepository['enabledRules']>
>[number];

/** Why a run stopped early; each maps to one fixed, sanitized message. */
type RunFailure = 'PROVIDER' | 'AUTH' | 'UNEXPECTED';

const RUN_FAILURE_MESSAGES: Record<RunFailure, string> = {
  PROVIDER: 'Gmail is temporarily unavailable; sync again later',
  AUTH: 'Gmail access was refused; reconnect Gmail',
  UNEXPECTED: 'Sync failed; sync again later',
};

/** 409 when another run holds the connection's lease (EMAIL-007). */
export const syncInProgress = () =>
  new ConflictException({
    statusCode: 409,
    message: 'A sync is already running for this connection',
    error: 'Conflict',
    code: 'SYNC_IN_PROGRESS',
  });

@Injectable()
export class EmailIngestionService {
  private readonly logger = new Logger(EmailIngestionService.name);

  /** Seam for deterministic tests. */
  now = () => new Date();

  constructor(
    private readonly repository: EmailIngestionRepository,
    private readonly connections: EmailConnectionsService,
    private readonly gmail: GmailApiService,
    private readonly parser: ParserService,
    private readonly users: UsersRepository,
    private readonly alerts: AlertEvaluationService,
  ) {}

  /**
   * One bounded, user-triggered sync batch (EMAIL-004–EMAIL-007, EMAIL-009,
   * EMAIL-013): at most one page of `SYNC_POLICY.batchSize` messages, inside
   * the run budget, under the connection's lease. Refusals come first (404,
   * 503 reconnect, 400 no rules, 409 lease) and create no run; after the
   * lease every outcome, including a provider failure, ends in a terminal
   * run that is returned.
   */
  async sync(user: RequestUser, connectionId: string) {
    const { accessToken } = await this.connections.validAccessToken(
      user.id,
      connectionId,
    );
    const rules = await this.repository.enabledRules(user.id, connectionId);
    if (!rules.length) {
      throw new BadRequestException(
        'At least one enabled listen rule is required',
      );
    }
    const started = this.now();
    const lease = await this.repository.acquireLease(
      user.id,
      connectionId,
      started,
    );
    if (!lease) {
      this.logger.warn({
        event: 'email.sync.rejected',
        userId: user.id,
        emailConnectionId: connectionId,
        errorCode: 'SYNC_IN_PROGRESS',
      });
      throw syncInProgress();
    }
    this.logger.log({
      event: 'email.sync.started',
      userId: user.id,
      emailConnectionId: connectionId,
      syncRunId: lease.run.id,
    });

    const query = this.gmailQuery(rules);
    const queryHash = hashQuery(query);
    const before = parseCursor(lease.connection.syncCursor);
    const backfillFrom =
      lease.connection.backfillFrom ??
      backfillBoundary(
        rules.map((rule) => rule.syncFromDate),
        started,
      );
    let window = planWindow(before, { now: started, backfillFrom, queryHash });
    const retries: Record<string, number> = { ...(before?.retries ?? {}) };

    const counts = {
      emailsFound: 0,
      emailsMatched: 0,
      emailsParsed: 0,
      emailsFailed: 0,
      transactionsCreated: 0,
    };
    /** Transactions this batch created (for one alert evaluation). */
    const createdTransactionIds: string[] = [];
    let listed = false;
    let handled = 0;
    let pageComplete = false;
    let nextPageToken: string | undefined;
    let failure: RunFailure | undefined;

    try {
      const page = await this.listPage(accessToken, query, window);
      window = page.window;
      nextPageToken = page.nextPageToken;
      counts.emailsFound = page.ids.length;
      listed = true;
      pageComplete = true;

      for (const [index, providerMessageId] of page.ids.entries()) {
        // At least one message per run, so a slow listing still progresses.
        if (
          index > 0 &&
          this.now().getTime() - started.getTime() >= SYNC_POLICY.runBudgetMs
        ) {
          pageComplete = false; // the rest of the page is the continuation
          break;
        }
        try {
          await this.processMessage(
            user,
            connectionId,
            rules,
            accessToken,
            providerMessageId,
            counts,
            createdTransactionIds,
          );
          handled += 1;
          delete retries[providerMessageId];
        } catch (error) {
          counts.emailsFailed += 1;
          const kind = error instanceof GmailApiError ? error.kind : undefined;
          if (kind === 'NOT_FOUND' || kind === 'PERMANENT') {
            handled += 1; // permanent: never blocks the page (EMAIL-009)
            continue;
          }
          if (
            kind === 'AUTH' ||
            kind === 'RATE_LIMITED' ||
            kind === 'REFUSED'
          ) {
            // Not this message's fault: stop and retry the page later.
            pageComplete = false;
            failure = kind === 'AUTH' ? 'AUTH' : 'PROVIDER';
            break;
          }
          // A transient Gmail failure or an unexpected error may be this
          // message itself; after the attempt limit it is given up.
          if (!kind) this.logUnexpected(lease.run.id, error);
          const attempts = (retries[providerMessageId] ?? 0) + 1;
          if (attempts >= SYNC_POLICY.maxMessageAttempts) {
            delete retries[providerMessageId];
            await this.repository.markMessageFailed(
              connectionId,
              providerMessageId,
            );
            handled += 1;
            continue;
          }
          retries[providerMessageId] = attempts;
          pageComplete = false; // retried by the next sync
          if (kind) {
            failure = 'PROVIDER';
            break;
          }
        }
      }
    } catch (error) {
      failure =
        error instanceof GmailApiError
          ? error.kind === 'AUTH'
            ? 'AUTH'
            : 'PROVIDER'
          : 'UNEXPECTED';
      if (failure === 'UNEXPECTED') this.logUnexpected(lease.run.id, error);
    }

    const status: EmailSyncStatus =
      failure && handled === 0
        ? 'FAILED'
        : failure || counts.emailsFailed
          ? 'PARTIAL_FAILED'
          : 'SUCCESS';
    const connection: SyncConnectionOutcome = {
      status:
        failure === 'AUTH'
          ? 'EXPIRED'
          : status === 'FAILED'
            ? 'ERROR'
            : 'ACTIVE',
      errorMessage:
        failure === 'AUTH'
          ? RECONNECT_REQUIRED_MESSAGE
          : status === 'FAILED'
            ? RUN_FAILURE_MESSAGES[failure!]
            : null,
    };
    if (failure) connection.lastFailedAt = this.now();
    let hasMore = false;
    let cursorAfter: string | null = null;
    if (listed && status !== 'FAILED') {
      const next = advanceCursor(before, window, {
        queryHash,
        pageComplete,
        nextPageToken,
        retries,
      });
      hasMore = !next.windowComplete;
      cursorAfter = serializeCursor(next.cursor);
      connection.syncCursor = cursorAfter;
      connection.lastSyncedAt = this.now();
      if (!lease.connection.backfillFrom)
        connection.backfillFrom = backfillFrom;
      if (next.windowComplete && !lease.connection.backfillCompletedAt) {
        connection.backfillCompletedAt = this.now();
      }
    }

    const finished = await this.repository.finishRun(
      { token: lease.token, runId: lease.run.id, connectionId },
      {
        status,
        ...counts,
        hasMore,
        cursorAfter,
        errorMessage:
          status === 'FAILED'
            ? RUN_FAILURE_MESSAGES[failure!]
            : counts.emailsFailed
              ? `${counts.emailsFailed} message(s) failed`
              : failure
                ? RUN_FAILURE_MESSAGES[failure]
                : null,
      },
      connection,
    );
    await this.auditSync(user, connectionId, finished.id, finished.status, {
      ...counts,
    });
    const level = finished.status === 'SUCCESS' ? 'log' : 'warn';
    this.logger[level]({
      event: 'email.sync.finished',
      userId: user.id,
      emailConnectionId: connectionId,
      syncRunId: finished.id,
      status: finished.status,
      errorCode: failure ?? null,
      hasMore,
      ...counts,
    });
    // After the batch committed (ALERT-009): imported transactions are
    // evaluated exactly like manual ones, once per batch; then the terminal
    // run (and any run the lease expired) and the connection state.
    // Evaluation never fails the sync.
    if (createdTransactionIds.length) {
      await this.alerts.onTransactionsChanged(user.id, {
        largeTransactionIds: createdTransactionIds,
      });
    }
    await this.alerts.onSyncRunFinished(user.id);
    return toEmailSyncRunResponse(finished);
  }

  /**
   * A run still RUNNING after a whole lease (the process stopped, and no
   * later sync recorded it) is shown as EXPIRED.
   */
  async listRuns(user: RequestUser, connectionId: string) {
    await this.connections.findOwned(user.id, connectionId);
    const staleBefore = this.now().getTime() - SYNC_POLICY.leaseTtlMs;
    return (await this.repository.listRuns(connectionId)).map((run) =>
      toEmailSyncRunResponse(
        run.status === 'RUNNING' && run.startedAt.getTime() < staleBefore
          ? { ...run, status: 'EXPIRED', errorMessage: EXPIRED_RUN_MESSAGE }
          : run,
      ),
    );
  }

  async listMessages(user: RequestUser, query: ListEmailMessagesDto) {
    if (query.emailConnectionId) {
      await this.connections.findOwned(user.id, query.emailConnectionId);
    }
    const result = await this.repository.listMessages(user.id, query);
    return {
      ...result,
      data: result.data.map(toEmailMessageResponse),
    };
  }

  /**
   * One page of the window. Gmail refuses a page token it no longer accepts;
   * the window is then read again from its start, which is safe because
   * processed messages are skipped by provider id.
   */
  private async listPage(
    accessToken: string,
    query: string,
    window: SyncWindow,
  ) {
    const list = (target: SyncWindow) =>
      this.gmail.listMessageIds(accessToken, windowQuery(query, target), {
        pageToken: target.pageToken,
        maxResults: SYNC_POLICY.batchSize,
      });
    try {
      return { window, ...(await list(window)) };
    } catch (error) {
      if (
        !window.pageToken ||
        !(error instanceof GmailApiError) ||
        (error.kind !== 'PERMANENT' && error.kind !== 'NOT_FOUND')
      ) {
        throw error;
      }
      const restarted = {
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
      };
      return { window: restarted, ...(await list(restarted)) };
    }
  }

  /**
   * Provider-message layer first (EMAIL-008): a message already parsed,
   * failed, or ignored is neither fetched nor parsed again. The raw body is
   * held only in this call and handed to the parser (EMAIL-012).
   */
  private async processMessage(
    user: RequestUser,
    connectionId: string,
    rules: ListenRule[],
    accessToken: string,
    providerMessageId: string,
    counts: {
      emailsMatched: number;
      emailsParsed: number;
      emailsFailed: number;
      transactionsCreated: number;
    },
    createdTransactionIds: string[],
  ) {
    const known = await this.repository.findMessageByProvider(
      connectionId,
      providerMessageId,
    );
    if (known && known.processingStatus !== 'PENDING') return;

    const message = await this.gmail.getMessage(accessToken, providerMessageId);
    const body = this.gmail.body(message);
    const sender = this.parseSender(this.gmail.header(message, 'From') ?? '');
    const subject = this.gmail.header(message, 'Subject') ?? '';
    const receivedAt = message.internalDate
      ? new Date(Number(message.internalDate))
      : this.now();
    const rule = rules.find((candidate) =>
      this.matches(candidate, sender.email, subject, body, receivedAt),
    );
    if (!rule) return;

    const saved = await this.repository.upsertMessage({
      userId: user.id,
      emailConnectionId: connectionId,
      providerMessageId: message.id,
      providerThreadId: message.threadId,
      providerHistoryId: message.historyId,
      messageIdHeader: this.gmail.header(message, 'Message-ID'),
      senderEmail: sender.email,
      senderName: sender.name,
      subject,
      receivedAt,
      bodyHash: body
        ? createHash('sha256').update(body).digest('hex')
        : undefined,
      processingStatus: 'PENDING',
      matchedRuleId: rule.id,
      bankProviderId: rule.bankProviderId,
    });
    await this.repository.markRuleMatched(rule.id);
    counts.emailsMatched += 1;
    const result = await this.parser.parseMessage(user, saved.id, body);
    if ('transactionId' in result) {
      counts.emailsParsed += 1;
      if (result.created) {
        counts.transactionsCreated += 1;
        createdTransactionIds.push(result.transactionId);
      }
    } else {
      counts.emailsFailed += 1; // a sanitized parser-run failure was recorded
    }
  }

  /** The error class only; messages of unexpected errors may carry data. */
  private logUnexpected(runId: string, error: unknown) {
    this.logger.warn({
      event: 'email.sync.unexpected_error',
      syncRunId: runId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  /** Sanitized evidence of a sync (SEC-006): run id, status, and counts only. */
  private auditSync(
    user: RequestUser,
    connectionId: string,
    syncRunId: string,
    status: EmailSyncStatus,
    counts: Record<string, number>,
  ) {
    return this.users.recordAudit({
      actorType: AuditActorType.USER,
      actorId: user.id,
      action: 'EMAIL_SYNC',
      resourceType: 'email_connection',
      resourceId: connectionId,
      metadata: { syncRunId, status, ...counts },
    });
  }

  /** Sender and subject clauses; the time window is added per run. */
  private gmailQuery(rules: ListenRule[]) {
    const clauses = rules.flatMap((rule) => {
      const values: string[] = [];
      if (rule.senderEmail) values.push(`from:${rule.senderEmail}`);
      if (rule.senderDomain) values.push(`from:@${rule.senderDomain}`);
      if (rule.subjectContains)
        values.push(`subject:"${rule.subjectContains}"`);
      return values;
    });
    return clauses.length ? `{${clauses.join(' ')}}` : '';
  }

  private matches(
    rule: ListenRule,
    sender: string,
    subject: string,
    body: string,
    receivedAt: Date,
  ) {
    const normalizedSender = sender.toLowerCase();
    return (
      (!rule.syncFromDate || receivedAt >= rule.syncFromDate) &&
      (!rule.senderEmail ||
        normalizedSender === rule.senderEmail.toLowerCase()) &&
      (!rule.senderDomain ||
        normalizedSender.endsWith(`@${rule.senderDomain.toLowerCase()}`)) &&
      (!rule.subjectContains ||
        subject.toLowerCase().includes(rule.subjectContains.toLowerCase())) &&
      (!rule.bodyContains ||
        body.toLowerCase().includes(rule.bodyContains.toLowerCase()))
    );
  }

  private parseSender(value: string) {
    const match = value.match(/^(.*?)<([^>]+)>$/);
    return {
      name: match?.[1]?.trim().replace(/^"|"$/g, '') || undefined,
      email: (match?.[2] ?? value).trim().toLowerCase(),
    };
  }
}
