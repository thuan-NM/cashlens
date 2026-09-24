import { BudgetPeriod, Prisma } from '@prisma/client';
import {
  BudgetEvaluationBudget,
  evaluateBudgetThresholds,
} from './budget-threshold.evaluator';

/**
 * ALERT-009 budget rows, BUDGET-002, BUDGET-003, BUDGET-005 (T071). Pure: the
 * input carries each budget's spend in its current instance.
 */

const HCM = 'Asia/Ho_Chi_Minh';
const DAY1 = { timeZone: HCM, monthStartDay: 1 };
const DAY25 = { timeZone: HCM, monthStartDay: 25 };
const NOW = new Date('2026-09-23T03:00:00.000Z');

const budget = (
  overrides: Partial<BudgetEvaluationBudget> = {},
): BudgetEvaluationBudget => ({
  id: 'b1',
  name: 'Food',
  period: 'MONTHLY',
  categoryId: 'food',
  currency: 'VND',
  amount: new Prisma.Decimal(1_000_000),
  thresholdPercent: 80,
  startsAt: new Date('2026-01-01T00:00:00.000Z'),
  endsAt: null,
  spent: new Prisma.Decimal(0),
  ...overrides,
});

const evaluate = (
  budgets: BudgetEvaluationBudget[],
  openKeys: string[] = [],
  settings = DAY1,
  now = NOW,
) => evaluateBudgetThresholds({ now, settings, budgets, openKeys });

const byKey = (conditions: ReturnType<typeof evaluate>) =>
  Object.fromEntries(conditions.map((condition) => [condition.key, condition]));

describe('evaluateBudgetThresholds (T071)', () => {
  it('evaluates WARNING and CRITICAL separately, keyed by the instance start', () => {
    const conditions = byKey(
      evaluate([budget({ spent: new Prisma.Decimal(850_000) })]),
    );

    expect(Object.keys(conditions).sort()).toEqual([
      'budget:b1:2026-09-01:CRITICAL',
      'budget:b1:2026-09-01:WARNING',
    ]);
    expect(conditions['budget:b1:2026-09-01:WARNING']).toMatchObject({
      holds: true,
      mayCreate: true,
      type: 'BUDGET_THRESHOLD',
      severity: 'WARNING',
      target: { resourceType: 'budget', resourceId: 'b1' },
      window: {
        start: new Date('2026-08-31T17:00:00.000Z'),
        end: new Date('2026-09-30T17:00:00.000Z'),
      },
    });
    expect(String(conditions['budget:b1:2026-09-01:WARNING'].threshold)).toBe(
      '80',
    );
    expect(String(conditions['budget:b1:2026-09-01:WARNING'].observed)).toBe(
      '85',
    );
    expect(conditions['budget:b1:2026-09-01:CRITICAL']).toMatchObject({
      holds: false,
      severity: 'CRITICAL',
      resolutionReason: 'BELOW_THRESHOLD',
    });
    expect(String(conditions['budget:b1:2026-09-01:CRITICAL'].threshold)).toBe(
      '100',
    );
  });

  it('holds both tiers when one jump crosses 80% and 100%', () => {
    const conditions = evaluate([
      budget({ spent: new Prisma.Decimal(1_200_000) }),
    ]);
    expect(conditions.filter((condition) => condition.holds)).toHaveLength(2);
  });

  it('holds at exactly the threshold', () => {
    const conditions = byKey(
      evaluate([budget({ spent: new Prisma.Decimal(800_000) })]),
    );
    expect(conditions['budget:b1:2026-09-01:WARNING'].holds).toBe(true);
    expect(conditions['budget:b1:2026-09-01:CRITICAL'].holds).toBe(false);
  });

  it("uses the user-month start in the user's timezone (month-start day 25)", () => {
    const conditions = evaluate(
      [budget({ spent: new Prisma.Decimal(900_000) })],
      [],
      DAY25,
    );
    expect(conditions.map((condition) => condition.key).sort()).toEqual([
      'budget:b1:2026-08-25:CRITICAL',
      'budget:b1:2026-08-25:WARNING',
    ]);
    expect(conditions[0].window).toEqual({
      start: new Date('2026-08-24T17:00:00.000Z'),
      end: new Date('2026-09-24T17:00:00.000Z'),
    });
  });

  it('reports the clipped usage range for a budget starting inside the instance', () => {
    const [condition] = evaluate([
      budget({
        startsAt: new Date('2026-09-10T00:00:00.000Z'),
        spent: new Prisma.Decimal(900_000),
      }),
    ]);
    expect(condition.window).toEqual({
      start: new Date('2026-09-09T17:00:00.000Z'),
      end: new Date('2026-09-30T17:00:00.000Z'),
    });
  });

  it('has no warning condition for a legacy threshold of 100 or more, only critical', () => {
    const conditions = evaluate([
      budget({ thresholdPercent: 150, spent: new Prisma.Decimal(1_000_000) }),
    ]);
    expect(conditions.map((condition) => condition.key)).toEqual([
      'budget:b1:2026-09-01:CRITICAL',
    ]);
    expect(conditions[0].holds).toBe(true);
  });

  it.each(['WEEKLY', 'YEARLY', 'CUSTOM'] as BudgetPeriod[])(
    'produces no condition for a %s budget',
    (period) => {
      expect(
        evaluate([budget({ period, spent: new Prisma.Decimal(5_000_000) })]),
      ).toEqual([]);
    },
  );

  it('produces no condition for a budget with no instance now (not started or ended)', () => {
    expect(
      evaluate([
        budget({
          startsAt: new Date('2026-10-05T00:00:00.000Z'),
          spent: new Prisma.Decimal(5_000_000),
        }),
      ]),
    ).toEqual([]);
  });

  it('resolves an open key of a past instance with PERIOD_ENDED and never creates for it', () => {
    const conditions = byKey(
      evaluate(
        [budget({ spent: new Prisma.Decimal(0) })],
        ['budget:b1:2026-08-01:WARNING', 'budget:b1:2026-08-01:CRITICAL'],
      ),
    );
    for (const key of [
      'budget:b1:2026-08-01:WARNING',
      'budget:b1:2026-08-01:CRITICAL',
    ]) {
      expect(conditions[key]).toMatchObject({
        holds: false,
        mayCreate: false,
        resolutionReason: 'PERIOD_ENDED',
      });
    }
  });

  it('resolves the open keys of an ended budget with PERIOD_ENDED', () => {
    const conditions = evaluate(
      [
        budget({
          endsAt: new Date('2026-08-31T00:00:00.000Z'),
          spent: new Prisma.Decimal(0),
        }),
      ],
      ['budget:b1:2026-08-01:CRITICAL'],
    );
    expect(conditions).toEqual([
      expect.objectContaining({
        key: 'budget:b1:2026-08-01:CRITICAL',
        holds: false,
        resolutionReason: 'PERIOD_ENDED',
      }),
    ]);
  });

  it('resolves the open keys of an archived, deactivated, or deleted budget with TARGET_REMOVED', () => {
    const conditions = evaluate([], ['budget:gone:2026-09-01:WARNING']);
    expect(conditions).toEqual([
      expect.objectContaining({
        key: 'budget:gone:2026-09-01:WARNING',
        holds: false,
        mayCreate: false,
        resolutionReason: 'TARGET_REMOVED',
        target: { resourceType: 'budget', resourceId: 'gone' },
      }),
    ]);
  });

  it('resolves the open keys of a budget changed away from MONTHLY', () => {
    const conditions = evaluate(
      [budget({ period: 'WEEKLY', spent: new Prisma.Decimal(5_000_000) })],
      ['budget:b1:2026-09-01:WARNING'],
    );
    expect(conditions).toEqual([
      expect.objectContaining({
        key: 'budget:b1:2026-09-01:WARNING',
        holds: false,
        resolutionReason: 'TARGET_REMOVED',
      }),
    ]);
  });

  it('resolves a threshold change that makes the warning fail', () => {
    const conditions = byKey(
      evaluate(
        [budget({ thresholdPercent: 90, spent: new Prisma.Decimal(850_000) })],
        ['budget:b1:2026-09-01:WARNING'],
      ),
    );
    expect(conditions['budget:b1:2026-09-01:WARNING']).toMatchObject({
      holds: false,
      resolutionReason: 'BELOW_THRESHOLD',
    });
  });

  it('keeps each budget in its own currency and states it in the explanation', () => {
    const conditions = evaluate([
      budget({
        id: 'usd',
        currency: 'usd',
        amount: new Prisma.Decimal('100.00'),
        spent: new Prisma.Decimal('100.00'),
      }),
      budget({ id: 'vnd', spent: new Prisma.Decimal(0) }),
    ]);
    const usd = conditions.find(
      (condition) => condition.key === 'budget:usd:2026-09-01:CRITICAL',
    );
    expect(usd).toMatchObject({
      holds: true,
      metadata: expect.objectContaining({
        currency: 'USD',
        spent: '100',
        amount: '100',
        percentUsed: '100',
      }) as object,
    });
    expect(
      conditions
        .filter((condition) => condition.key.startsWith('budget:vnd:'))
        .every((condition) => !condition.holds),
    ).toBe(true);
  });

  it('holds nothing for a zero-amount budget', () => {
    expect(
      evaluate([
        budget({ amount: new Prisma.Decimal(0), spent: new Prisma.Decimal(5) }),
      ]).every((condition) => !condition.holds),
    ).toBe(true);
  });

  it('is pure: the same input gives the same output', () => {
    const input = [budget({ spent: new Prisma.Decimal(900_000) })];
    expect(evaluate(input)).toEqual(evaluate(input));
  });
});
