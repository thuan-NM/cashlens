import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ListEmailMessagesDto } from './dto/list-email-messages.dto';
import { buildEmailMessageWhere } from './query/email-messages.query';

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

  createRun(emailConnectionId: string) {
    return this.prisma.emailSyncRun.create({
      data: { emailConnectionId, triggerType: 'MANUAL' },
    });
  }

  finishRun(
    id: string,
    data: Prisma.EmailSyncRunUncheckedUpdateInput,
  ) {
    return this.prisma.emailSyncRun.update({ where: { id }, data });
  }

  listRuns(emailConnectionId: string) {
    return this.prisma.emailSyncRun.findMany({
      where: { emailConnectionId },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  upsertMessage(data: Prisma.EmailMessageUncheckedCreateInput) {
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
        snippet: data.snippet,
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

  markConnectionSynced(id: string) {
    return this.prisma.emailConnection.update({
      where: { id },
      data: { lastSyncedAt: new Date(), status: 'ACTIVE', errorMessage: null },
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
