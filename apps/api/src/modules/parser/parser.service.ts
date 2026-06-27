import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestUser } from '../../common/types/request-user.type';
import { CreateParserTemplateDto } from './dto/create-parser-template.dto';
import { UpdateParserTemplateDto } from './dto/update-parser-template.dto';
import { ParserEngineService } from './parser-engine.service';
import {
  toParserRunResponse,
  toParserTemplateResponse,
} from './parser.mapper';
import { ParserRepository } from './parser.repository';

@Injectable()
export class ParserService {
  constructor(
    private readonly repository: ParserRepository,
    private readonly engine: ParserEngineService,
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

  async parseMessage(user: RequestUser, messageId: string, body?: string) {
    const message = await this.repository.findMessageOwned(user.id, messageId);
    if (!message) throw new NotFoundException('Email message not found');
    if (message.transaction) {
      return { transactionId: message.transaction.id, created: false };
    }

    const bankProviderId =
      message.bankProviderId ??
      (
        await this.repository.verifiedBankBySender(message.senderEmail)
      )?.bankProviderId;
    if (!bankProviderId) {
      return this.fail(message.id, null, 'Unable to identify bank provider');
    }

    const templates = await this.repository.activeTemplates(bankProviderId);
    const parserBody = body ?? message.snippet ?? '';
    const template = templates.find((candidate) =>
      this.engine.matches(candidate, message.subject ?? '', parserBody),
    );
    if (!template) {
      return this.fail(message.id, null, 'No active parser template matched');
    }

    try {
      const result = this.engine.parse(
        template,
        message.subject ?? '',
        parserBody,
        message.receivedAt,
      );
      const bank = await this.repository.findBankProvider(bankProviderId);
      const transactionResult =
        await this.repository.createTransactionFromParse({
          messageId: message.id,
          templateId: template.id,
          userId: user.id,
          bankProviderId,
          externalTransactionId: message.providerMessageId,
          amount: result.normalized.amount!,
          currency: result.normalized.currency!,
          direction: result.normalized.direction!,
          transactionTime: new Date(result.normalized.transactionTime!),
          description:
            result.normalized.description ?? message.subject ?? undefined,
          balanceAfter: result.normalized.balanceAfter,
          transactionCode: result.normalized.transactionCode,
          merchantName: result.normalized.merchantName,
          counterpartyName: result.normalized.counterpartyName,
          extracted: result.extracted,
          normalized: result.normalized as Prisma.InputJsonValue,
          confidence: result.confidence,
          bankName: bank?.name,
        });
      return {
        transactionId: transactionResult.transaction.id,
        created: transactionResult.created,
      };
    } catch (error) {
      return this.fail(
        message.id,
        template.id,
        error instanceof Error ? error.message : 'Parser failed',
      );
    }
  }

  async listRuns(user: RequestUser, messageId: string) {
    if (!(await this.repository.findMessageOwned(user.id, messageId))) {
      throw new NotFoundException('Email message not found');
    }
    return (await this.repository.listRuns(messageId)).map(toParserRunResponse);
  }

  private async fail(
    emailMessageId: string,
    parserTemplateId: string | null,
    errorMessage: string,
  ) {
    const run = await this.repository.createFailureRun({
      emailMessageId,
      parserTemplateId,
      status: 'FAILED',
      extractedPayload: {},
      normalizedPayload: {},
      errorMessage,
    });
    return { parserRun: toParserRunResponse(run), created: false };
  }
}
