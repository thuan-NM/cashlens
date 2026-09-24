import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import { transactionIdentity } from '../email-ingestion/transaction-identity';
import { CreateParserTemplateDto } from './dto/create-parser-template.dto';
import { UpdateParserTemplateDto } from './dto/update-parser-template.dto';
import {
  ParserEngineService,
  ParserFailureCode,
  ParserOutputError,
} from './parser-engine.service';
import { toParserRunResponse, toParserTemplateResponse } from './parser.mapper';
import { ParserRepository } from './parser.repository';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';

@Injectable()
export class ParserService {
  constructor(
    private readonly repository: ParserRepository,
    private readonly engine: ParserEngineService,
    private readonly alerts: AlertEvaluationService,
  ) {}

  async listTemplates() {
    return (await this.repository.listTemplates()).map(
      toParserTemplateResponse,
    );
  }

  async createTemplate(dto: CreateParserTemplateDto) {
    this.engine.validateTemplate(dto);
    try {
      return toParserTemplateResponse(
        await this.repository.createTemplate(dto),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Parser template version already exists');
      }
      throw error;
    }
  }

  async updateTemplate(id: string, dto: UpdateParserTemplateDto) {
    if (!(await this.repository.findTemplate(id))) {
      throw new NotFoundException('Parser template not found');
    }
    this.engine.validateTemplate(dto);
    return toParserTemplateResponse(
      await this.repository.updateTemplate(id, dto),
    );
  }

  /**
   * Parses one owned message; `body` is the transient raw body and is never
   * stored (EMAIL-012). Only a complete, valid result can become a POSTED
   * transaction (EMAIL-011); a repeated event is linked to the transaction
   * that already represents it (EMAIL-007, EMAIL-008).
   */
  async parseMessage(user: RequestUser, messageId: string, body?: string) {
    const message = await this.repository.findMessageOwned(user.id, messageId);
    if (!message) throw new NotFoundException('Email message not found');
    if (message.transaction) {
      return { transactionId: message.transaction.id, created: false };
    }
    // Bodies are never stored (EMAIL-012): without a transient body or a
    // legacy snippet there is nothing to parse, and nothing is recorded, so
    // a PENDING message stays available to the next sync.
    if (body === undefined && !message.snippet) {
      throw new ConflictException({
        statusCode: 409,
        message:
          'The message body is not stored; synchronize the connection to parse it',
        error: 'Conflict',
        code: 'EMAIL_BODY_UNAVAILABLE',
      });
    }

    const bankProviderId =
      message.bankProviderId ??
      (await this.repository.verifiedBankBySender(message.senderEmail))
        ?.bankProviderId;
    if (!bankProviderId) {
      return this.fail(message.id, null, 'NO_BANK_PROVIDER');
    }

    const templates = await this.repository.activeTemplates(bankProviderId);
    const parserBody = body ?? message.snippet ?? '';
    const template = templates.find((candidate) =>
      this.engine.matches(candidate, message.subject ?? '', parserBody),
    );
    if (!template) {
      return this.fail(message.id, null, 'NO_TEMPLATE_MATCHED');
    }

    let result: ReturnType<ParserEngineService['parse']>;
    try {
      result = this.engine.parse(
        template,
        message.subject ?? '',
        parserBody,
        message.receivedAt,
      );
    } catch (error) {
      // Only the code and field names are kept, never the message text.
      return error instanceof ParserOutputError
        ? this.fail(message.id, template.id, error.code, error.fields)
        : this.fail(message.id, template.id, 'PARSER_ERROR');
    }

    const { normalized } = result;
    const identity = transactionIdentity(normalized, bankProviderId);
    const bank = await this.repository.findBankProvider(bankProviderId);
    const outcome = await this.repository.createTransactionFromParse({
      messageId: message.id,
      templateId: template.id,
      userId: user.id,
      bankProviderId,
      externalTransactionId: message.providerMessageId,
      amount: normalized.amount,
      currency: normalized.currency,
      direction: normalized.direction,
      transactionTime: new Date(normalized.transactionTime),
      description: normalized.description ?? message.subject ?? undefined,
      balanceAfter: normalized.balanceAfter,
      transactionCode: normalized.transactionCode,
      merchantName: normalized.merchantName,
      counterpartyName: normalized.counterpartyName,
      deduplicationKey: identity.key,
      deduplicationStrategy: identity.strategy,
      evidence: result.evidence,
      confidence: result.confidence,
      bankName: bank?.name,
    });
    return {
      transactionId: outcome.transaction.id,
      created: outcome.created,
      ...(outcome.duplicate ? { duplicate: true } : {}),
      ...(outcome.suspectedDuplicate ? { suspectedDuplicate: true } : {}),
    };
  }

  /**
   * `POST /email-messages/:id/parse`: a user-requested parse. A transaction
   * it creates is evaluated for alerts like any imported or manual one
   * (ALERT-009), after the write. A sync evaluates its whole batch once
   * instead, so `parseMessage` itself never evaluates.
   */
  async parseRequested(user: RequestUser, messageId: string) {
    const result = await this.parseMessage(user, messageId);
    if ('transactionId' in result && result.created) {
      await this.alerts.onTransactionsChanged(user.id, {
        largeTransactionIds: [result.transactionId],
      });
    }
    return result;
  }

  async listRuns(user: RequestUser, messageId: string) {
    if (!(await this.repository.findMessageOwned(user.id, messageId))) {
      throw new NotFoundException('Email message not found');
    }
    return (await this.repository.listRuns(messageId)).map(toParserRunResponse);
  }

  /**
   * A sanitized failure record (EMAIL-010, EMAIL-011): a code and field
   * names, no captured values or provider text.
   */
  private async fail(
    emailMessageId: string,
    parserTemplateId: string | null,
    code: ParserFailureCode,
    fields: string[] = [],
  ) {
    const run = await this.repository.createFailureRun({
      emailMessageId,
      parserTemplateId,
      status: 'FAILED',
      extractedPayload: {},
      normalizedPayload: {},
      errorMessage: new ParserOutputError(code, fields).message,
    });
    return { parserRun: toParserRunResponse(run), created: false };
  }
}
