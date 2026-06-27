import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ParserTemplateWithFields,
  toParserTemplateCreateInput,
  toParserTemplateUpdateInput,
} from './parser.mapper';
import { CreateParserTemplateDto } from './dto/create-parser-template.dto';
import { UpdateParserTemplateDto } from './dto/update-parser-template.dto';

const templateInclude = {
  fields: { orderBy: { priority: 'asc' as const } },
};

@Injectable()
export class ParserRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
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

  createFailureRun(data: Prisma.ParserRunUncheckedCreateInput) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.parserRun.create({ data });
      await tx.emailMessage.update({
        where: { id: data.emailMessageId },
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
    extracted: Prisma.InputJsonValue;
    normalized: Prisma.InputJsonValue;
    confidence: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({
        where: { emailMessageId: input.messageId },
      });
      if (existing) return { transaction: existing, created: false };

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
          classificationSource: 'UNKNOWN',
          confidence: input.confidence,
        },
      });

      await tx.parserRun.create({
        data: {
          emailMessageId: input.messageId,
          parserTemplateId: input.templateId,
          status: 'SUCCESS',
          confidenceScore: input.confidence,
          extractedPayload: input.extracted,
          normalizedPayload: input.normalized,
          createdTransactionId: transaction.id,
        },
      });
      await tx.emailMessage.update({
        where: { id: input.messageId },
        data: { processingStatus: 'PARSED', errorMessage: null },
      });
      return { transaction, created: true };
    });
  }
}
