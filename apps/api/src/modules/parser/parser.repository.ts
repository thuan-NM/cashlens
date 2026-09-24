import { Injectable } from '@nestjs/common';
import { Prisma, TransactionDeduplicationStrategy } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ClassificationService,
  decisionColumns,
} from '../transactions/classification.service';
import {
  ParserTemplateWithFields,
  toParserTemplateCreateInput,
  toParserTemplateUpdateInput,
} from './parser.mapper';
import { CreateParserTemplateDto } from './dto/create-parser-template.dto';
import { UpdateParserTemplateDto } from './dto/update-parser-template.dto';
import type { FieldEvidence } from './parser-engine.service';

const templateInclude = {
  fields: { orderBy: { priority: 'asc' as const } },
};

@Injectable()
export class ParserRepository extends BaseRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationService,
  ) {
    super();
  }

  listTemplates() {
    return this.prisma.parserTemplate.findMany({
      include: templateInclude,
      orderBy: [
        { bankProviderId: 'asc' },
        { priority: 'asc' },
        { version: 'desc' },
      ],
    }) as Promise<ParserTemplateWithFields[]>;
  }

  createTemplate(dto: CreateParserTemplateDto) {
    return this.prisma.parserTemplate.create({
      data: toParserTemplateCreateInput(dto),
      include: templateInclude,
    }) as Promise<ParserTemplateWithFields>;
  }

  updateTemplate(id: string, dto: UpdateParserTemplateDto) {
    return this.prisma.parserTemplate.update({
      where: { id },
      data: toParserTemplateUpdateInput(dto),
      include: templateInclude,
    }) as Promise<ParserTemplateWithFields>;
  }

  findTemplate(id: string) {
    return this.prisma.parserTemplate.findUnique({
      where: { id },
      include: templateInclude,
    }) as Promise<ParserTemplateWithFields | null>;
  }

  activeTemplates(bankProviderId: string) {
    return this.prisma.parserTemplate.findMany({
      where: {
        bankProviderId,
        channel: 'EMAIL',
        isActive: true,
      },
      include: templateInclude,
      orderBy: [{ priority: 'asc' }, { version: 'desc' }],
    }) as Promise<ParserTemplateWithFields[]>;
  }

  findMessageOwned(userId: string, id: string) {
    return this.prisma.emailMessage.findFirst({
      where: { id, userId },
      include: { transaction: true },
    });
  }

  verifiedBankBySender(senderEmail: string) {
    return this.prisma.bankEmailSender.findFirst({
      where: {
        senderEmail: senderEmail.toLowerCase(),
        isVerified: true,
        status: 'ACTIVE',
      },
      select: { bankProviderId: true },
    });
  }

  findBankProvider(id: string) {
    return this.prisma.bankProvider.findUnique({
      where: { id },
      select: { name: true },
    });
  }

  /**
   * Records a sanitized failed attempt. A message another path has already
   * imported keeps its PARSED status.
   */
  createFailureRun(data: Prisma.ParserRunUncheckedCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.parserRun.create({ data });
      await tx.emailMessage.updateMany({
        where: {
          id: data.emailMessageId,
          processingStatus: { not: 'PARSED' },
        },
        data: {
          processingStatus: 'FAILED',
          errorMessage: data.errorMessage,
        },
      });
      return run;
    });
  }

  listRuns(emailMessageId: string) {
    return this.prisma.parserRun.findMany({
      where: { emailMessageId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Imports one valid parse result atomically with layered deduplication
   * (EMAIL-007, EMAIL-008): the message's own transaction first, then the
   * owner's transaction with the same identity key (transaction code, else
   * fingerprint). A repeated event links to that transaction instead of
   * creating another. The owner-scoped unique indexes settle a concurrent
   * race; the losing write is retried once and then finds the winner.
   * Parser runs keep match status and the deduplication decision only.
   */
  async createTransactionFromParse(input: {
    messageId: string;
    templateId: string;
    userId: string;
    bankProviderId: string;
    bankName?: string;
    externalTransactionId: string;
    amount: number;
    currency: string;
    direction: Prisma.TransactionUncheckedCreateInput['direction'];
    transactionTime: Date;
    description?: string;
    balanceAfter?: number;
    transactionCode?: string;
    merchantName?: string;
    counterpartyName?: string;
    deduplicationKey: string;
    deduplicationStrategy: TransactionDeduplicationStrategy;
    evidence: Record<string, FieldEvidence>;
    confidence: number;
  }) {
    try {
      return await this.importOnce(input);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.importOnce(input);
    }
  }

  private importOnce(
    input: Parameters<ParserRepository['createTransactionFromParse']>[0],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({
        where: { emailMessageId: input.messageId },
      });
      if (existing) {
        return {
          transaction: existing,
          created: false,
          duplicate: false,
          suspectedDuplicate: false,
        };
      }

      const original = await tx.transaction.findUnique({
        where: {
          userId_deduplicationFingerprint: {
            userId: input.userId,
            deduplicationFingerprint: input.deduplicationKey,
          },
        },
      });
      const sameFacts = original && {
        amount: original.amount.equals(input.amount),
        direction: original.direction === input.direction,
        currency: original.currency === input.currency,
      };
      // Only the bank's own transaction code with identical facts proves the
      // same event; any other match is kept, flagged, and reversible.
      if (
        original &&
        sameFacts &&
        input.deduplicationStrategy === 'TRANSACTION_CODE' &&
        sameFacts.amount &&
        sameFacts.direction &&
        sameFacts.currency
      ) {
        await this.recordSuccess(tx, input, null, {
          strategy: input.deduplicationStrategy,
          outcome: 'DUPLICATE',
          duplicateOfTransactionId: original.id,
          sameFacts,
        });
        return {
          transaction: original,
          created: false,
          duplicate: true,
          suspectedDuplicate: false,
        };
      }

      // A created row gets the automatic decision in the same transaction
      // (T055); a replay or a certain duplicate creates nothing to classify.
      const decision = await this.classification.decideNew(tx, {
        userId: input.userId,
        merchantName: input.merchantName,
        counterpartyName: input.counterpartyName,
        description: input.description,
        bankName: input.bankName,
        direction: input.direction,
      });
      const transaction = await tx.transaction.create({
        data: {
          userId: input.userId,
          emailMessageId: input.messageId,
          bankProviderId: input.bankProviderId,
          bankName: input.bankName,
          sourceType: 'EMAIL',
          sourceId: input.messageId,
          externalTransactionId: input.externalTransactionId,
          transactionCode: input.transactionCode,
          amount: input.amount,
          currency: input.currency,
          direction: input.direction,
          transactionTime: input.transactionTime,
          description: input.description,
          normalizedDescription: input.description?.trim().toLowerCase(),
          balanceAfter: input.balanceAfter,
          merchantName: input.merchantName,
          counterpartyName: input.counterpartyName,
          status: 'POSTED',
          ...(decision
            ? decisionColumns(decision, new Date())
            : { classificationSource: 'UNKNOWN' as const }),
          confidence: input.confidence,
          deduplicationStrategy: input.deduplicationStrategy,
          // A suspected duplicate is excluded from totals (US2 eligibility)
          // until the user clears the flag; it holds no identity key.
          ...(original
            ? { isDuplicate: true, duplicateOfTransactionId: original.id }
            : { deduplicationFingerprint: input.deduplicationKey }),
        },
      });
      if (decision) {
        await this.classification.record(tx, {
          transactionId: transaction.id,
          userId: input.userId,
          previousCategoryId: null,
          decision,
          trigger: 'IMPORT',
          actor: { type: 'SYSTEM' },
        });
      }
      await this.recordSuccess(
        tx,
        input,
        transaction.id,
        original
          ? {
              strategy: input.deduplicationStrategy,
              outcome: 'SUSPECTED_DUPLICATE',
              duplicateOfTransactionId: original.id,
              sameFacts,
            }
          : { strategy: input.deduplicationStrategy, outcome: 'CREATED' },
      );
      return {
        transaction,
        created: true,
        duplicate: false,
        suspectedDuplicate: Boolean(original),
      };
    });
  }

  /**
   * The sanitized success record: match status per field and the
   * deduplication decision (EMAIL-008 explainability), never captured text.
   */
  private async recordSuccess(
    tx: Prisma.TransactionClient,
    input: Parameters<ParserRepository['createTransactionFromParse']>[0],
    createdTransactionId: string | null,
    deduplication: Prisma.InputJsonObject,
  ) {
    await tx.parserRun.create({
      data: {
        emailMessageId: input.messageId,
        parserTemplateId: input.templateId,
        status: 'SUCCESS',
        confidenceScore: input.confidence,
        extractedPayload: input.evidence,
        normalizedPayload: { deduplication },
        createdTransactionId,
      },
    });
    await tx.emailMessage.update({
      where: { id: input.messageId },
      data: { processingStatus: 'PARSED', errorMessage: null },
    });
  }
}
