import { Prisma } from '@prisma/client';
import type { CompletedMonthCashflow } from '../../../common/finance/completed-month-cashflow';
import { GoalEvaluationGoal, evaluateGoalRisk } from './goal-risk.evaluator';

/**
 * ALERT-009 goal-risk row, GOAL-002, GOAL-004, SC-008 (T073), with the
 * data-model worked examples. The evaluator applies `computeFeasibility` to
 * the goal's stored horizon only (never the QUERY what-if).
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');
const SETTINGS = { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 };
const D = (value: string | number) => new Prisma.Decimal(value);

/** H1: nets Jun 9,000,000; Jul 8,000,000; Aug 10,000,001 → available 9,000,000. */
const H1: CompletedMonthCashflow = {
  currency: 'VND',
  historyStartMonth: '2025-01',
  months: [
    { key: '2026-06', net: D(9_000_000) },
    { key: '2026-07', net: D(8_000_000) },
    { key: '2026-08', net: D(10_000_001) },
  ],
};

const goal = (
  overrides: Partial<GoalEvaluationGoal> = {},
): GoalEvaluationGoal => ({
  id: 'g1',
  name: 'Car',
  status: 'ACTIVE',
  targetAmount: D(45_000_000),
  savedAmount: D(5_000_000),
  currency: 'VND',
  targetDate: new Date('2026-12-15T00:00:00.000Z'),
  months: null,
  createdAt: new Date('2026-01-10T00:00:00.000Z'),
  observation: H1,
  ...overrides,
});

const evaluate = (goals: GoalEvaluationGoal[], openKeys: string[] = []) =>
  evaluateGoalRisk({ now: NOW, settings: SETTINGS, goals, openKeys });

describe('evaluateGoalRisk (T073)', () => {
  it('G1: holds when required (10,000,000) exceeds available (9,000,000)', () => {
    const [condition] = evaluate([goal()]);
    expect(condition).toMatchObject({
      key: 'goal:g1',
      holds: true,
      mayCreate: true,
      type: 'GOAL_RISK',
      severity: 'WARNING',
      target: { resourceType: 'goal', resourceId: 'g1' },
      window: {
        start: new Date('2026-05-31T17:00:00.000Z'),
        end: new Date('2026-08-31T17:00:00.000Z'),
      },
    });
    expect(String(condition.threshold)).toBe('9000000');
    expect(String(condition.observed)).toBe('10000000');
    expect(condition.metadata).toMatchObject({
      horizonSource: 'TARGET_DATE',
      feasibilityScore: 90,
      feasibilityStatus: 'ACCEPTABLE',
      months: 4,
      currency: 'VND',
    });
  });

  it('G2 (stored horizon): a goal with no date or months uses the DEFAULT horizon and does not hold', () => {
    const [condition] = evaluate([
      goal({
        targetAmount: D(10_000_000),
        savedAmount: D(0),
        targetDate: null,
        months: null,
      }),
    ]);
    expect(condition).toMatchObject({
      holds: false,
      resolutionReason: 'BELOW_THRESHOLD',
      metadata: expect.objectContaining({
        horizonSource: 'DEFAULT',
        months: 6,
      }) as object,
    });
    expect(String(condition.observed)).toBe('1666667');
  });

  it('G3: a deadline in the current month with enough cashflow does not hold', () => {
    expect(
      evaluate([
        goal({
          targetAmount: D(5_000_000),
          savedAmount: D(1_000_000),
          targetDate: new Date('2026-09-30T00:00:00.000Z'),
        }),
      ])[0].holds,
    ).toBe(false);
  });

  it('G4: past deadline holds when the remaining amount exceeds available', () => {
    const [condition] = evaluate([
      goal({
        targetAmount: D(20_000_000),
        savedAmount: D(8_000_000),
        targetDate: new Date('2026-08-31T00:00:00.000Z'),
      }),
    ]);
    expect(condition).toMatchObject({
      holds: true,
      metadata: expect.objectContaining({
        pastDeadline: true,
        months: 0,
      }) as object,
    });
    expect(String(condition.observed)).toBe('12000000');
  });

  it('G4 variant: past deadline does not hold when available covers the remaining amount', () => {
    expect(
      evaluate([
        goal({
          targetAmount: D(10_000_000),
          savedAmount: D(8_000_000),
          targetDate: new Date('2026-08-31T00:00:00.000Z'),
        }),
      ])[0].holds,
    ).toBe(false);
  });

  it('G5: a completed target does not hold, even past its deadline', () => {
    const [condition] = evaluate([
      goal({
        targetAmount: D(10_000_000),
        savedAmount: D(12_000_000),
        targetDate: new Date('2026-01-31T00:00:00.000Z'),
      }),
    ]);
    expect(condition).toMatchObject({
      holds: false,
      resolutionReason: 'CONDITION_CLEARED',
    });
  });

  it('G8: insufficient history does not hold and resolves with INSUFFICIENT_DATA', () => {
    const [condition] = evaluate([
      goal({
        targetAmount: D(1e12),
        observation: {
          currency: 'VND',
          historyStartMonth: '2026-08',
          months: [{ key: '2026-08', net: D(-5) }],
        },
      }),
    ]);
    expect(condition).toMatchObject({
      holds: false,
      resolutionReason: 'INSUFFICIENT_DATA',
    });
  });

  it('G6 nets: a negative available cashflow makes any remaining goal hold', () => {
    expect(
      evaluate([
        goal({
          targetAmount: D(20_000_000),
          savedAmount: D(0),
          observation: {
            currency: 'VND',
            historyStartMonth: '2026-01',
            months: [
              { key: '2026-06', net: D(-2_000_000) },
              { key: '2026-07', net: D(-1_000_000) },
              { key: '2026-08', net: D(-1_500_001) },
            ],
          },
        }),
      ])[0].holds,
    ).toBe(true);
  });

  it("uses GOAL_MONTHS from the goal's creation month (G10a) when there is no target date", () => {
    const [condition] = evaluate([
      goal({
        targetDate: null,
        months: 6,
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      }),
    ]);
    expect(condition.metadata).toMatchObject({
      horizonSource: 'GOAL_MONTHS',
      months: 4,
    });
    expect(condition.holds).toBe(true); // 40,000,000 / 4 > 9,000,000
  });

  it.each(['PAUSED', 'COMPLETED', 'ARCHIVED'] as const)(
    'resolves a %s goal with TARGET_REMOVED and never holds',
    (status) => {
      expect(evaluate([goal({ status })], ['goal:g1'])).toEqual([
        expect.objectContaining({
          key: 'goal:g1',
          holds: false,
          mayCreate: false,
          resolutionReason: 'TARGET_REMOVED',
        }),
      ]);
    },
  );

  it('resolves the open key of a deleted goal with TARGET_REMOVED', () => {
    expect(evaluate([], ['goal:gone'])).toEqual([
      expect.objectContaining({
        key: 'goal:gone',
        holds: false,
        resolutionReason: 'TARGET_REMOVED',
        target: { resourceType: 'goal', resourceId: 'gone' },
      }),
    ]);
  });
});
