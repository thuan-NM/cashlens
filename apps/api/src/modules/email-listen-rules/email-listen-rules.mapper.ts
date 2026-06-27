import { Prisma } from '@prisma/client';
import { CreateEmailListenRuleDto } from './dto/create-email-listen-rule.dto';
import { UpdateEmailListenRuleDto } from './dto/update-email-listen-rule.dto';

export const toCreateEmailListenRuleInput = (
  userId: string,
  dto: CreateEmailListenRuleDto,
): Prisma.EmailListenRuleUncheckedCreateInput => ({
  userId,
  name: dto.name,
  emailConnectionId: dto.emailConnectionId,
  bankProviderId: dto.bankProviderId,
  senderEmail: dto.senderEmail?.trim().toLowerCase(),
  senderDomain: dto.senderDomain?.trim().toLowerCase(),
  subjectContains: dto.subjectContains,
  bodyContains: dto.bodyContains,
  syncFromDate: dto.syncFromDate ? new Date(dto.syncFromDate) : undefined,
  isEnabled: dto.isEnabled,
  priority: dto.priority,
});

export const toUpdateEmailListenRuleInput = (
  dto: UpdateEmailListenRuleDto,
): Prisma.EmailListenRuleUncheckedUpdateInput => ({
  name: dto.name,
  emailConnectionId: dto.emailConnectionId,
  bankProviderId: dto.bankProviderId,
  senderEmail: dto.senderEmail?.trim().toLowerCase(),
  senderDomain: dto.senderDomain?.trim().toLowerCase(),
  subjectContains: dto.subjectContains,
  bodyContains: dto.bodyContains,
  syncFromDate: dto.syncFromDate ? new Date(dto.syncFromDate) : undefined,
  isEnabled: dto.isEnabled,
  priority: dto.priority,
});

export const toEmailListenRuleResponse = (rule: {
  id: string;
  userId: string;
  emailConnectionId: string | null;
  bankProviderId: string | null;
  name: string;
  senderEmail: string | null;
  senderDomain: string | null;
  subjectContains: string | null;
  bodyContains: string | null;
  syncFromDate: Date | null;
  isEnabled: boolean;
  priority: number;
  lastMatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  ...rule,
  syncFromDate: rule.syncFromDate?.toISOString() ?? null,
  lastMatchedAt: rule.lastMatchedAt?.toISOString() ?? null,
  createdAt: rule.createdAt.toISOString(),
  updatedAt: rule.updatedAt.toISOString(),
});
