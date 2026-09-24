import { Prisma } from '@prisma/client';
import type { CompletedMonthCashflow } from '../../../common/finance/completed-month-cashflow';
import { evaluateCashflowRisk } from './cashflow-risk.evaluator';

/**
 * ALERT-009 cashflow-risk row, GOAL-003, SC-008 (T074): the projected net is
 * the floor of the mean completed-month net in the base currency, the same
 * computation as GOAL-003. Goal commitments are not subtracted.
 */

const NOW = new Date('2026-09-23T10:00:00+07:00');
const SETTINGS = { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 };
const D = (value: string | number) => new Prisma.Decimal(value);

const observation = (
  nets: [string, number | string][],
  currency = 'VND',
): CompletedMonthCashflow => ({
  currency,
  historyStartMonth: nets[0]?.[0] ?? null,
  months: nets.map(([key, net]) => ({ key, net: D(net) })),
});

const evaluate = (observed: CompletedMonthCashflow) =>
  evaluateCashflowRisk({
    now: NOW,
    settings: SETTINGS,
    userId: 'u1',
    baseCurrency: observed.currency,
    observation: observed,
  });

describe('evaluateCashflowRisk (T074)', () => {
  it('G6: a negative 3-month mean (-1,500,001 after floor) holds as CRITICAL', () => {
    const [condition] = evaluate(
      observation([
        ['2026-06', -2_000_000],
        ['2026-07', -1_000_000],
        ['2026-08', -1_500_001],
      ]),
    );
    expect(condition).toMatchObject({
      key: 'cashflow:u1',
      holds: true,
      mayCreate: true,
      type: 'CASHFLOW_RISK',
      severity: 'CRITICAL',
      target: { resourceType: 'user', resourceId: 'u1' },
      window: {
        start: new Date('2026-05-31T17:00:00.000Z'),
        end: new Date('2026-08-31T17:00:00.000Z'),
      },
      metadata: expect.objectContaining({
        currency: 'VND',
        observationMonths: '2026-06,2026-07,2026-08',
      }) as object,
    });
    expect(String(condition.observed)).toBe('-1500001');
    expect(String(condition.threshold)).toBe('0');
  });

  it('holds with two observed months (the minimum)', () => {
    expect(
      evaluate(
        observation([
          ['2026-07', -3],
          ['2026-08', 0],
        ]),
      )[0].holds,
    ).toBe(true);
  });

  it('does not hold at a projection of exactly 0', () => {
    expect(
      evaluate(
        observation([
          ['2026-07', -5],
          ['2026-08', 5],
        ]),
      )[0],
    ).toMatchObject({ holds: false, resolutionReason: 'BELOW_THRESHOLD' });
  });

  it('floors toward -infinity: a mean of -0.5 VND is -1 and holds', () => {
    const [condition] = evaluate(
      observation([
        ['2026-07', -1],
        ['2026-08', 0],
      ]),
    );
    expect(condition.holds).toBe(true);
    expect(String(condition.observed)).toBe('-1');
  });

  it('rounds to 0.01 for a non-VND base currency', () => {
    const [condition] = evaluate(
      observation(
        [
          ['2026-06', '-0.01'],
          ['2026-07', '0'],
          ['2026-08', '0'],
        ],
        'USD',
      ),
    );
    expect(condition.holds).toBe(true);
    expect(String(condition.observed)).toBe('-0.01');
  });

  it('does not subtract goal commitments: a positive mean does not hold', () => {
    expect(
      evaluate(
        observation([
          ['2026-06', 9_000_000],
          ['2026-07', 8_000_000],
          ['2026-08', 10_000_001],
        ]),
      )[0].holds,
    ).toBe(false);
  });

  it.each([
    ['no history', []],
    ['one month', [['2026-08', -9_000_000]]],
  ] as [string, [string, number][]][])(
    'resolves with INSUFFICIENT_DATA for %s',
    (_label, nets) => {
      expect(evaluate(observation(nets))[0]).toMatchObject({
        holds: false,
        resolutionReason: 'INSUFFICIENT_DATA',
        observed: null,
      });
    },
  );

  it('has no window without any observed month', () => {
    expect(evaluate(observation([]))[0].window).toBeNull();
  });
});
