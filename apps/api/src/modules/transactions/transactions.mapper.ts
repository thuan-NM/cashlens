import { ClassificationSource, Prisma } from '@prisma/client';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

export const transactionInclude = {
  account: true,
  category: true,
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : Number(value.toString());

const dateToIso = (value: Date | null) => value?.toISOString() ?? null;

export const toTransactionResponse = (
  transaction: TransactionWithRelations,
) => ({
  id: transaction.id,
  userId: transaction.userId,
  rawEmailId: transaction.rawEmailId,
  categoryId: transaction.categoryId,
  financialAccountId: transaction.financialAccountId,
  bankProviderId: transaction.bankProviderId,
  bankName: transaction.bankName,
  merchantName: transaction.merchantName,
  counterpartyName: transaction.counterpartyName,
  sourceType: transaction.sourceType,
  sourceId: transaction.sourceId,
  externalTransactionId: transaction.externalTransactionId,
  transactionCode: transaction.transactionCode,
  amount: decimalToNumber(transaction.amount),
  currency: transaction.currency,
  direction: transaction.direction,
  transactionTime: transaction.transactionTime.toISOString(),
  postedDate: dateToIso(transaction.postedDate),
  description: transaction.description,
  normalizedDescription: transaction.normalizedDescription,
  balanceAfter: decimalToNumber(transaction.balanceAfter),
  feeAmount: decimalToNumber(transaction.feeAmount),
  status: transaction.status,
  isDuplicate: transaction.isDuplicate,
  duplicateOfTransactionId: transaction.duplicateOfTransactionId,
  classificationSource: transaction.classificationSource,
  classificationConfidence: decimalToNumber(
    transaction.classificationConfidence,
  ),
  userNote: transaction.userNote,
  metadata: transaction.metadata,
  account: transaction.account,
  category: transaction.category,
  createdAt: transaction.createdAt.toISOString(),
  updatedAt: transaction.updatedAt.toISOString(),
});

export const toCreateTransactionInput = (
  userId: string,
  dto: CreateTransactionDto,
): Prisma.TransactionUncheckedCreateInput => ({
  userId,
  financialAccountId: dto.financialAccountId,
  categoryId: dto.categoryId,
  sourceType: 'MANUAL',
  amount: dto.amount,
  currency: dto.currency,
  direction: dto.direction,
  transactionTime: new Date(dto.transactionTime),
  postedDate: dto.postedDate ? new Date(dto.postedDate) : undefined,
  merchantName: dto.merchantName,
  counterpartyName: dto.counterpartyName,
  description: dto.description,
  normalizedDescription: dto.description?.trim().toLowerCase(),
  balanceAfter: dto.balanceAfter,
  feeAmount: dto.feeAmount,
  status: dto.status ?? 'POSTED',
  isDuplicate: dto.isDuplicate,
  duplicateOfTransactionId: dto.duplicateOfTransactionId,
  classificationSource:
    dto.classificationSource ??
    (dto.categoryId ? ClassificationSource.MANUAL : ClassificationSource.UNKNOWN),
  classificationConfidence: dto.classificationConfidence,
  userNote: dto.userNote,
  metadata: dto.metadata,
});

export const toUpdateTransactionInput = (
  dto: UpdateTransactionDto,
): Prisma.TransactionUncheckedUpdateInput => ({
  financialAccountId: dto.financialAccountId,
  categoryId: dto.categoryId,
  amount: dto.amount,
  currency: dto.currency,
  direction: dto.direction,
  transactionTime: dto.transactionTime ? new Date(dto.transactionTime) : undefined,
  postedDate: dto.postedDate ? new Date(dto.postedDate) : undefined,
  merchantName: dto.merchantName,
  counterpartyName: dto.counterpartyName,
  description: dto.description,
  normalizedDescription: dto.description?.trim().toLowerCase(),
  balanceAfter: dto.balanceAfter,
  feeAmount: dto.feeAmount,
  status: dto.status,
  isDuplicate: dto.isDuplicate,
  duplicateOfTransactionId: dto.duplicateOfTransactionId,
  classificationSource: dto.classificationSource,
  classificationConfidence: dto.classificationConfidence,
  userNote: dto.userNote,
  metadata: dto.metadata,
});
