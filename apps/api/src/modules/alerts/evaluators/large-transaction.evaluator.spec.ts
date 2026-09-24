import { Prisma } from '@prisma/client';
import {
  LARGE_TRANSACTION_VND_DEFAULT,
  LargeTransactionRow,
  evaluateLargeTransactions,
} from './large-transaction.evaluator';

/**
 * ALERT-009 large-transaction row (T072). Only the transactions the trigger
 * changed are evaluated, so a threshold change never re-evaluates others.
 */

const SETTINGS = { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 };
const NOW = new Date('2026-09-23T03:00:00.000Z');

const tx = (
  overrides: Partial<LargeTransactionRow> = {},
): LargeTransactionRow => ({
  amount: new Prisma.Decimal(5_000_000),
  currency: 'VND',
  direction: 'EXPENSE',
  status: 'POSTED',
  isDuplicate: false,
  transactionTime: new Date('2026-09-20T03:00:00.000Z'),
  ...overrides,
});

const evaluate = (
  row: LargeTransactionRow | null,
  options: { baseCurrency?: string; threshold?: Prisma.Decimal | null } = {},
) =>
  evaluateLargeTransactions({
    now: NOW,
    settings: SETTINGS,
    baseCurrency: options.baseCurrency ?? 'VND',
    threshold: options.threshold ?? null,
    transactions: [{ id: 't1', row }],
  });

describe('evaluateLargeTransactions (T072)', () => {
  it('defaults to 5,000,000 for a VND base currency', () => {
    expect(LARGE_TRANSACTION_VND_DEFAULT.toString()).toBe('5000000');
  });

  it('holds at exactly the threshold, as a WARNING keyed by the transaction', () => {
    const [condition] = evaluate(tx());
    expect(condition).toMatchObject({
      key: 'large-tx:t1',
      holds: true,
      mayCreate: true,
      type: 'LARGE_TRANSACTION',
      severity: 'WARNING',
      target: { resourceType: 'transaction', resourceId: 't1' },
    });
    expect(String(condition.threshold)).toBe('5000000');
    expect(String(condition.observed)).toBe('5000000');
  });

  it('does not hold one unit below the threshold', () => {
    const [condition] = evaluate(
      tx({ amount: new Prisma.Decimal('4999999.99') }),
    );
    expect(condition).toMatchObject({
      holds: false,
      resolutionReason: 'BELOW_THRESHOLD',
    });
  });

  it("uses the user's threshold when set", () => {
    expect(
      evaluate(tx({ amount: new Prisma.Decimal(2_000_000) }), {
        threshold: new Prisma.Decimal(2_000_000),
      })[0].holds,
    ).toBe(true);
  });

  it('is inactive for a non-VND base currency without a threshold', () => {
    expect(
      evaluate(tx({ currency: 'USD', amount: new Prisma.Decimal(1e9) }), {
        baseCurrency: 'USD',
      })[0],
    ).toMatchObject({ holds: false, resolutionReason: 'BELOW_THRESHOLD' });
  });

  it('applies a set threshold for a non-VND base currency', () => {
    expect(
      evaluate(tx({ currency: 'usd', amount: new Prisma.Decimal('300.00') }), {
        baseCurrency: 'USD',
        threshold: new Prisma.Decimal(300),
      })[0].holds,
    ).toBe(true);
  });

  it('counts only the base currency', () => {
    expect(
      evaluate(tx({ currency: 'USD', amount: new Prisma.Decimal(9e9) }))[0]
        .holds,
    ).toBe(false);
  });

  it.each(['INCOME', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT'] as const)(
    'never holds for a %s transaction',
    (direction) => {
      expect(
        evaluate(tx({ direction, amount: new Prisma.Decimal(9e9) }))[0],
      ).toMatchObject({ holds: false });
    },
  );

  it('creates only when the transaction date is in the current user month', () => {
    const [last] = evaluate(
      tx({ transactionTime: new Date('2026-08-31T16:59:59.999Z') }),
    );
    expect(last).toMatchObject({ holds: true, mayCreate: false });
    const [first] = evaluate(
      tx({ transactionTime: new Date('2026-08-31T17:00:00.000Z') }),
    );
    expect(first).toMatchObject({ holds: true, mayCreate: true });
  });

  it.each([
    ['deleted', null],
    ['DELETED status', tx({ status: 'DELETED' })],
    ['ignored', tx({ status: 'IGNORED' })],
    ['a confirmed duplicate', tx({ isDuplicate: true })],
    ['pending', tx({ status: 'PENDING' })],
  ])('resolves when the transaction is %s', (_label, row) => {
    expect(evaluate(row)[0]).toMatchObject({
      key: 'large-tx:t1',
      holds: false,
      resolutionReason: 'TARGET_REMOVED',
    });
  });

  it('resolves when the amount drops below the threshold', () => {
    expect(evaluate(tx({ amount: new Prisma.Decimal(10) }))[0]).toMatchObject({
      holds: false,
      resolutionReason: 'BELOW_THRESHOLD',
    });
  });

  it('evaluates only the given transactions', () => {
    expect(
      evaluateLargeTransactions({
        now: NOW,
        settings: SETTINGS,
        baseCurrency: 'VND',
        threshold: new Prisma.Decimal(1),
        transactions: [],
      }),
    ).toEqual([]);
  });

  it('keeps the email-free explanation to the amount and currency', () => {
    const [condition] = evaluate(tx({ amount: new Prisma.Decimal(7_500_000) }));
    expect(condition.metadata).toEqual({
      transactionId: 't1',
      amount: '7500000',
      currency: 'VND',
      threshold: '5000000',
    });
  });
});
