import type { TransactionDirection } from '@prisma/client';
import { createHash } from 'node:crypto';

/**
 * Layered deduplication keys for imported transactions (EMAIL-007, EMAIL-008).
 * Precedence, highest first:
 *
 * 1. Provider message identity: the same Gmail message (connection + provider
 *    message id) is never processed twice (unique `EmailMessage`).
 * 2. Provider transaction identity: the bank's transaction code, scoped to the
 *    bank. A match with the same amount, direction, and currency is certain,
 *    so no second transaction is created; a match whose facts differ is only
 *    suspected (flagged as below).
 * 3. Fingerprint, when no code exists: bank, direction, currency, amount,
 *    minute, and balance after. A match is only suspected, so the new row is
 *    kept but flagged as a duplicate of the original (explainable and
 *    reversible by the user).
 *
 * The key strings are versioned (`v1`); DB-M2 backfills the code keys of
 * legacy imports with the same normalization.
 */

export type DeduplicationStrategy = 'TRANSACTION_CODE' | 'FINGERPRINT';

export type ImportedTransactionFacts = {
  amount: number;
  currency: string;
  direction: TransactionDirection;
  transactionTime: string;
  transactionCode?: string;
  balanceAfter?: number;
};

const ASCII_WHITESPACE = /[ \t\n\r\f\v]/g;

/** Matches the DB-M2 SQL: ASCII whitespace removed, upper case. */
export const normalizeTransactionCode = (code: string): string =>
  code.replace(ASCII_WHITESPACE, '').toUpperCase();

export const transactionIdentity = (
  facts: ImportedTransactionFacts,
  bankProviderId: string,
): { strategy: DeduplicationStrategy; key: string } => {
  const code = facts.transactionCode
    ? normalizeTransactionCode(facts.transactionCode)
    : '';
  if (code) {
    return {
      strategy: 'TRANSACTION_CODE',
      key: `code:v1:${bankProviderId}:${code}`,
    };
  }
  const canonical = [
    bankProviderId,
    facts.direction,
    facts.currency,
    facts.amount.toFixed(2),
    // To the minute: bank notifications of one event can differ in seconds.
    new Date(facts.transactionTime).toISOString().slice(0, 16),
    facts.balanceAfter === undefined ? '' : facts.balanceAfter.toFixed(2),
  ].join('|');
  return {
    strategy: 'FINGERPRINT',
    key: `fp:v1:${createHash('sha256').update(canonical).digest('hex')}`,
  };
};
