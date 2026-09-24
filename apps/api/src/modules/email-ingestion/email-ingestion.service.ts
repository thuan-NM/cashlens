import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditActorType, EmailSyncStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RequestUser } from '../../common/types/request-user.type';
import { EmailConnectionsService } from '../email-connections/email-connections.service';
import { ParserService } from '../parser/parser.service';
import { UsersRepository } from '../users/users.repository';
import { ListEmailMessagesDto } from './dto/list-email-messages.dto';
import {
  toEmailMessageResponse,
  toEmailSyncRunResponse,
} from './email-ingestion.mapper';
import { EmailIngestionRepository } from './email-ingestion.repository';
import { GmailApiService, GmailMessage } from './gmail-api.service';

@Injectable()
export class EmailIngestionService {
  constructor(
    private readonly repository: EmailIngestionRepository,
    private readonly connections: EmailConnectionsService,
    private readonly gmail: GmailApiService,
    private readonly parser: ParserService,
    private readonly users: UsersRepository,
  ) {}

  async sync(user: RequestUser, connectionId: string) {
    const { connection, accessToken } = await this.connections.validAccessToken(
      user.id,
      connectionId,
    );
    const rules = await this.repository.enabledRules(user.id, connectionId);
    if (!rules.length) {
      throw new BadRequestException(
        'At least one enabled listen rule is required',
      );
    }

    const run = await this.repository.createRun(connectionId);
    let matched = 0;
    let failed = 0;
    let parsed = 0;
    let transactionsCreated = 0;
    let ids: string[] = [];

    try {
      ids = await this.gmail.listMessageIds(
        accessToken,
        this.gmailQuery(rules),
      );
      for (const id of ids) {
        try {
          const message = await this.gmail.getMessage(accessToken, id);
          const body = this.gmail.body(message);
          const sender = this.parseSender(
            this.gmail.header(message, 'From') ?? '',
          );
          const subject = this.gmail.header(message, 'Subject') ?? '';
          const rule = rules.find((candidate) =>
            this.matches(candidate, sender.email, subject, body),
          );
          if (!rule) continue;

          const savedMessage = await this.repository.upsertMessage({
            userId: user.id,
            emailConnectionId: connection.id,
            providerMessageId: message.id,
            providerThreadId: message.threadId,
            providerHistoryId: message.historyId,
            messageIdHeader: this.gmail.header(message, 'Message-ID'),
            senderEmail: sender.email,
            senderName: sender.name,
            subject,
            snippet: message.snippet,
            receivedAt: new Date(Number(message.internalDate ?? Date.now())),
            bodyHash: body
              ? createHash('sha256').update(body).digest('hex')
              : undefined,
            processingStatus: 'PENDING',
            matchedRuleId: rule.id,
            bankProviderId: rule.bankProviderId,
          });
          await this.repository.markRuleMatched(rule.id);
          matched += 1;
          const parseResult = await this.parser.parseMessage(
            user,
            savedMessage.id,
            body,
          );
          if ('transactionId' in parseResult) {
            parsed += 1;
            if (parseResult.created) transactionsCreated += 1;
          }
        } catch {
          failed += 1;
        }
      }

      await this.repository.markConnectionSynced(connectionId);
      const finished = await this.repository.finishRun(run.id, {
        status: failed ? 'PARTIAL_FAILED' : 'SUCCESS',
        finishedAt: new Date(),
        emailsFound: ids.length,
        emailsMatched: matched,
        emailsParsed: parsed,
        transactionsCreated,
        errorMessage: failed ? `${failed} message(s) failed` : null,
      });
      await this.auditSync(user, connectionId, run.id, finished.status, {
        emailsFound: ids.length,
        emailsMatched: matched,
        emailsParsed: parsed,
        emailsFailed: failed,
        transactionsCreated,
      });
      return toEmailSyncRunResponse(finished);
    } catch (error) {
      await this.repository.finishRun(run.id, {
        status: 'FAILED',
        finishedAt: new Date(),
        emailsFound: ids.length,
        emailsMatched: matched,
        emailsParsed: parsed,
        transactionsCreated,
        errorMessage: error instanceof Error ? error.message : 'Sync failed',
      });
      await this.auditSync(user, connectionId, run.id, 'FAILED', {
        emailsFound: ids.length,
        emailsMatched: matched,
        emailsParsed: parsed,
        emailsFailed: failed,
        transactionsCreated,
      });
      throw error;
    }
  }

  async listRuns(user: RequestUser, connectionId: string) {
    await this.connections.findOwned(user.id, connectionId);
    return (await this.repository.listRuns(connectionId)).map(
      toEmailSyncRunResponse,
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

  /** Sanitized evidence of a sync (SEC-006): run id, status, and counts only. */
  private auditSync(
    user: RequestUser,
    connectionId: string,
    syncRunId: string,
    status: EmailSyncStatus | 'FAILED',
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

  private gmailQuery(
    rules: Awaited<ReturnType<EmailIngestionRepository['enabledRules']>>,
  ) {
    const clauses = rules.flatMap((rule) => {
      const values: string[] = [];
      if (rule.senderEmail) values.push(`from:${rule.senderEmail}`);
      if (rule.senderDomain) values.push(`from:@${rule.senderDomain}`);
      if (rule.subjectContains)
        values.push(`subject:"${rule.subjectContains}"`);
      return values;
    });
    const earliest = rules
      .map((rule) => rule.syncFromDate)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const date = earliest
      ? ` after:${earliest.toISOString().slice(0, 10).replaceAll('-', '/')}`
      : '';
    return `${clauses.length ? `{${clauses.join(' ')}}` : ''}${date}`.trim();
  }

  private matches(
    rule: Awaited<ReturnType<EmailIngestionRepository['enabledRules']>>[number],
    sender: string,
    subject: string,
    body: string,
  ) {
    const normalizedSender = sender.toLowerCase();
    return (
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
