import {
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Synthetic ledger rows written straight to the database (T098). Suites use
 * them to set up history that no API trigger should see while it is
 * written, for example the completed months behind goal and cashflow
 * feasibility. Every value is synthetic (TEST-008).
 */
export type LedgerRow = {
  /** An ISO instant, usually with the +07:00 offset of the fixtures. */
  time: string;
  direction: TransactionDirection;
  amount: number | string;
  currency?: string;
  status?: TransactionStatus;
  isDuplicate?: boolean;
};

export const ledgerData = (
  userId: string,
  rows: LedgerRow[],
  description: string,
): Prisma.TransactionCreateManyInput[] =>
  rows.map((row) => ({
    userId,
    amount: new Prisma.Decimal(row.amount),
    currency: row.currency ?? 'VND',
    direction: row.direction,
    status: row.status ?? 'POSTED',
    isDuplicate: row.isDuplicate ?? false,
    transactionTime: new Date(row.time),
    description,
  }));

/** Writes the rows for the user; no alert or classification trigger runs. */
export const seedLedger = (
  prisma: Pick<PrismaService, 'transaction'>,
  userId: string,
  rows: LedgerRow[],
  description: string,
) =>
  prisma.transaction.createMany({
    data: ledgerData(userId, rows, description),
  });
