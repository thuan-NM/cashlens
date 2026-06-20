import { FinancialAccount, Prisma } from '@prisma/client';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto';

const decimalToNumber = (value: Prisma.Decimal | null) =>
  value === null ? null : Number(value.toString());

const dateToIso = (value: Date | null) => value?.toISOString() ?? null;

export const toFinancialAccountResponse = (account: FinancialAccount) => ({
  id: account.id,
  userId: account.userId,
  bankProviderId: account.bankProviderId,
  name: account.name,
  institutionName: account.institutionName,
  accountMask: account.accountMask,
  type: account.type,
  currency: account.currency,
  openingBalance: decimalToNumber(account.openingBalance),
  currentBalance: decimalToNumber(account.currentBalance),
  creditLimit: decimalToNumber(account.creditLimit),
  isDefault: account.isDefault,
  status: account.status,
  balanceUpdatedAt: dateToIso(account.balanceUpdatedAt),
  lastSyncedAt: dateToIso(account.lastSyncedAt),
  metadata: account.metadata,
  createdAt: account.createdAt.toISOString(),
  updatedAt: account.updatedAt.toISOString(),
});

export const toCreateFinancialAccountInput = (
  userId: string,
  dto: CreateFinancialAccountDto,
): Prisma.FinancialAccountUncheckedCreateInput => ({
  userId,
  name: dto.name,
  bankProviderId: dto.bankProviderId,
  institutionName: dto.institutionName,
  accountMask: dto.accountMask,
  type: dto.type,
  currency: dto.currency,
  openingBalance: dto.openingBalance,
  currentBalance: dto.currentBalance,
  creditLimit: dto.creditLimit,
  isDefault: dto.isDefault,
  status: dto.status,
  balanceUpdatedAt: dto.currentBalance === undefined ? undefined : new Date(),
  metadata: dto.metadata,
});

export const toUpdateFinancialAccountInput = (
  dto: UpdateFinancialAccountDto,
): Prisma.FinancialAccountUncheckedUpdateInput => ({
  name: dto.name,
  bankProviderId: dto.bankProviderId,
  institutionName: dto.institutionName,
  accountMask: dto.accountMask,
  type: dto.type,
  currency: dto.currency,
  openingBalance: dto.openingBalance,
  currentBalance: dto.currentBalance,
  creditLimit: dto.creditLimit,
  isDefault: dto.isDefault,
  status: dto.status,
  balanceUpdatedAt: dto.currentBalance === undefined ? undefined : new Date(),
  metadata: dto.metadata,
});
