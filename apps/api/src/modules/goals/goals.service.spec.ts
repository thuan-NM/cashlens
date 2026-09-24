import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Goal,
  Prisma,
  TransactionDirection,
  TransactionStatus,
} from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CompletedMonthCashflow,
  observationWindow,
} from '../../common/finance/completed-month-cashflow';
import {
  CASHFLOW_DIRECTIONS,
  PeriodSettings,
  isEligibleTransaction,
  isInRange,
  normalizeCurrency,
  userMonthContaining,
} from '../../common/finance/financial-period-policy';
import { Clock } from '../../common/time/clock';
import { Feasibility, computeFeasibility } from './goal-feasibility';
import { GoalsRepository } from './goals.repository';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';
import { GoalsService } from './goals.service';

// T058 (GOAL-002–GOAL-007, TEST-002, SC-008): the data-model worked examples
// G1–G10, exactly and to the VND, under the controlled clock of the examples.
// Months are user months; required saving rounds up to the currency unit,
// available cashflow and the score round down; fewer than two completed
// months is INSUFFICIENT_DATA; no fixed capacity value exists anywhere.

const NOW = new Date('2026-09-23T10:00:00+07:00');
const HCM: PeriodSettings = { timeZone: 'Asia/Ho_Chi_Minh', monthStartDay: 1 };
const USER = 'user-1';
const D = (value: string | number) => new Prisma.Decimal(value);

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'goal-1',
  userId: USER,
  name: 'Synthetic goal',
  type: null,
  targetAmount: D(0),
  savedAmount: D(0),
  currency: 'VND',
  targetDate: null,
  months: null,
  priority: 'MEDIUM',
  status: 'ACTIVE',
  metadata: null,
  createdAt: new Date('2026-09-01T09:00:00+07:00'),
  updatedAt: new Date('2026-09-01T09:00:00+07:00'),
  deletedAt: null,
  ...over,
});

/** Observation months (oldest first) with their nets. */
const observed = (
  nets: Record<string, number | string>,
  historyStartMonth: string | null = Object.keys(nets)[0] ?? null,
  currency = 'VND',
): CompletedMonthCashflow => ({
  currency,
  historyStartMonth,
  months: Object.entries(nets).map(([key, net]) => ({ key, net: D(net) })),
});

/** History H1: starts 2025-01; Jun 9,000,000; Jul 8,000,000; Aug 10,000,001. */
const H1 = observed(
  { '2026-06': 9_000_000, '2026-07': 8_000_000, '2026-08': 10_000_001 },
  '2025-01',
);

const run = (
  input: Partial<Goal>,
  options: {
    observation?: CompletedMonthCashflow;
    queryMonths?: number;
    settings?: PeriodSettings;
  } = {},
) =>
  computeFeasibility({
    goal: goal(input),
    now: NOW,
    queryMonths: options.queryMonths,
    observation: options.observation ?? H1,
    userMonthPolicy: options.settings ?? HCM,
  });

/** Decimals as exact strings, for whole-object comparisons. */
const view = (result: Feasibility) => ({
  ...result,
  remainingAmount: result.remainingAmount.toFixed(),
  monthlyRequired: result.monthlyRequired.toFixed(),
  availableMonthlyCashflow: result.availableMonthlyCashflow?.toFixed() ?? null,
});

const JUN_AUG = ['2026-06', '2026-07', '2026-08'];

describe('computeFeasibility: data-model worked examples (T058, SC-008)', () => {
  it('G1 positive, ACCEPTABLE: target date in December gives 4 periods; goal risk holds', () => {
    const result = run({
      targetAmount: D(45_000_000),
      savedAmount: D(5_000_000),
      targetDate: new Date('2026-12-15'),
    });
    expect(view(result)).toEqual({
      remainingAmount: '40000000',
      months: 4,
      horizonSource: 'TARGET_DATE',
      pastDeadline: false,
      monthlyRequired: '10000000',
      availableMonthlyCashflow: '9000000',
      feasibilityScore: 90,
      status: 'ACCEPTABLE',
      observationMonths: JUN_AUG,
      monthsRequired: 0,
      reason: 'COMPLETED_MONTHS_AVERAGE',
    });
    // Goal-risk condition (data-model step 10): required > available.
    expect(result.monthlyRequired.gt(result.availableMonthlyCashflow!)).toBe(
      true,
    );
  });

  it('G2 remainder rounds up: 10,000,000 over 3 periods is 3,333,334; score 269 caps to 100 SAFE', () => {
    expect(
      view(run({ targetAmount: D(10_000_000) }, { queryMonths: 3 })),
    ).toMatchObject({
      months: 3,
      horizonSource: 'QUERY',
      monthlyRequired: '3333334',
      feasibilityScore: 100,
      status: 'SAFE',
    });
  });

  it('G3 deadline in the current month: 1 period', () => {
    expect(
      view(
        run({
          targetAmount: D(5_000_000),
          savedAmount: D(1_000_000),
          targetDate: new Date('2026-09-30'),
        }),
      ),
    ).toMatchObject({
      months: 1,
      horizonSource: 'TARGET_DATE',
      pastDeadline: false,
      monthlyRequired: '4000000',
      feasibilityScore: 100,
      status: 'SAFE',
    });
  });

  it('G4 past deadline: 0 periods, the whole remaining amount due now, 75 RISKY', () => {
    expect(
      view(
        run({
          targetAmount: D(20_000_000),
          savedAmount: D(8_000_000),
          targetDate: new Date('2026-08-31'),
        }),
      ),
    ).toEqual({
      remainingAmount: '12000000',
      months: 0,
      horizonSource: 'TARGET_DATE',
      pastDeadline: true,
      monthlyRequired: '12000000',
      availableMonthlyCashflow: '9000000',
      feasibilityScore: 75,
      status: 'RISKY',
      observationMonths: JUN_AUG,
      monthsRequired: 0,
      reason: 'PAST_DEADLINE',
    });
  });

  // G5 runs with History H1, the common context of the worked examples.
  it.each([
    ['a past deadline', new Date('2026-08-31'), 0],
    ['a future deadline', new Date('2026-12-15'), 4],
    ['no deadline', null, 6],
  ])(
    'G5 target complete with %s: nothing required, 100 SAFE, not past deadline; goal risk does not hold',
    (_label, targetDate, months) => {
      const result = run({
        targetAmount: D(10_000_000),
        savedAmount: D(12_000_000),
        targetDate,
      });
      expect(view(result)).toMatchObject({
        remainingAmount: '0',
        months,
        // GOAL-002 and the contract flag past deadline only while an
        // amount remains (data-model step 3 is read with that condition).
        pastDeadline: false,
        monthlyRequired: '0',
        feasibilityScore: 100,
        status: 'SAFE',
        reason: 'TARGET_REACHED',
      });
      expect(result.monthlyRequired.gt(result.availableMonthlyCashflow!)).toBe(
        false,
      );
    },
  );

  it('G6 negative cashflow: available floors to -1,500,001 (toward -infinity); score 0 NOT_RECOMMENDED; cashflow risk holds', () => {
    const result = run(
      { targetAmount: D(20_000_000) },
      {
        queryMonths: 2,
        observation: observed({
          '2026-06': -2_000_000,
          '2026-07': -1_000_000,
          '2026-08': -1_500_001,
        }),
      },
    );
    expect(view(result)).toMatchObject({
      months: 2,
      monthlyRequired: '10000000',
      availableMonthlyCashflow: '-1500001',
      feasibilityScore: 0,
      status: 'NOT_RECOMMENDED',
    });
    // Cashflow-risk condition (data-model step 10): available < 0.
    expect(result.availableMonthlyCashflow!.isNegative()).toBe(true);
  });

  it.each([
    [10_000_000, 100, 'SAFE'],
    [9_999_999, 99, 'ACCEPTABLE'],
    [8_000_000, 80, 'ACCEPTABLE'],
    [7_999_999, 79, 'RISKY'],
    [5_000_000, 50, 'RISKY'],
    [4_999_999, 49, 'NOT_RECOMMENDED'],
    [0, 0, 'NOT_RECOMMENDED'],
  ])(
    'G7 band edge: required 10,000,000 and available %d give %d %s',
    (available, score, status) => {
      const result = run(
        { targetAmount: D(10_000_000) },
        {
          queryMonths: 1,
          observation: observed({
            '2026-07': available,
            '2026-08': available,
          }),
        },
      );
      expect(view(result)).toMatchObject({
        monthlyRequired: '10000000',
        availableMonthlyCashflow: String(available),
        feasibilityScore: score,
        status,
      });
    },
  );

  it.each([
    ['0 months', observed({}, '2026-09'), [], 2],
    ['1 month', observed({ '2026-08': 10_000_001 }), ['2026-08'], 1],
  ])(
    'G8 history of %s is INSUFFICIENT_DATA with no invented capacity',
    (_label, observation, months, monthsRequired) => {
      expect(
        view(
          run(
            {
              targetAmount: D(45_000_000),
              savedAmount: D(5_000_000),
              targetDate: new Date('2026-12-15'),
            },
            { observation },
          ),
        ),
      ).toEqual({
        remainingAmount: '40000000',
        months: 4,
        horizonSource: 'TARGET_DATE',
        pastDeadline: false,
        monthlyRequired: '10000000',
        availableMonthlyCashflow: null,
        feasibilityScore: null,
        status: 'INSUFFICIENT_DATA',
        observationMonths: months,
        monthsRequired,
        reason: 'INSUFFICIENT_HISTORY',
      });
    },
  );

  it.each([
    [
      '2 months (Jul, Aug): mean of 2',
      observed({ '2026-07': 8_000_000, '2026-08': 10_000_001 }),
      '9000000', // floor(18,000,001 / 2)
      ['2026-07', '2026-08'],
    ],
    ['3 months (Jun, Jul, Aug): mean of 3', H1, '9000000', JUN_AUG],
  ])('G8 history of %s', (_label, observation, available, months) => {
    expect(
      view(run({ targetAmount: D(10_000_000) }, { observation })),
    ).toMatchObject({
      availableMonthlyCashflow: available,
      observationMonths: months,
      monthsRequired: 0,
    });
  });

  it('G9 an empty month inside the window counts as 0', () => {
    expect(
      view(
        run(
          { targetAmount: D(10_000_000) },
          {
            observation: observed({
              '2026-06': 3_000_000,
              '2026-07': 0,
              '2026-08': 6_000_000,
            }),
          },
        ),
      ),
    ).toMatchObject({
      observationMonths: JUN_AUG,
      availableMonthlyCashflow: '3000000',
    });
  });

  it('G10 horizon sources: GOAL_MONTHS from the creation month, and the visible 6-month DEFAULT', () => {
    expect(
      run({
        targetAmount: D(10_000_000),
        months: 6,
        createdAt: new Date('2026-07-10T09:00:00+07:00'),
      }),
    ).toMatchObject({ months: 4, horizonSource: 'GOAL_MONTHS' });
    expect(run({ targetAmount: D(10_000_000) })).toMatchObject({
      months: 6,
      horizonSource: 'DEFAULT',
    });
  });
});

describe('computeFeasibility: rules beyond the worked examples', () => {
  it('horizon precedence is query, then target date, then planned months, then the default', () => {
    const all = {
      targetAmount: D(10_000_000),
      targetDate: new Date('2026-12-15'),
      months: 12,
      createdAt: new Date('2026-07-10T09:00:00+07:00'),
    };
    expect(run(all, { queryMonths: 2 })).toMatchObject({
      horizonSource: 'QUERY',
      months: 2,
    });
    expect(run(all)).toMatchObject({ horizonSource: 'TARGET_DATE', months: 4 });
    expect(run({ ...all, targetDate: null })).toMatchObject({
      horizonSource: 'GOAL_MONTHS',
      months: 10, // 2026-07 + 12 - 1 = 2027-06; Sep 2026 to Jun 2027
    });
  });

  it('planned months that ended before the current month are a past deadline', () => {
    expect(
      view(
        run({
          targetAmount: D(9_000_000),
          months: 2,
          createdAt: new Date('2026-06-15T09:00:00+07:00'),
        }),
      ),
    ).toMatchObject({
      horizonSource: 'GOAL_MONTHS',
      months: 0,
      pastDeadline: true,
      monthlyRequired: '9000000',
      reason: 'PAST_DEADLINE',
    });
  });

  it('other currencies use a unit of 0.01: required rounds up, available rounds down, negatives away from zero', () => {
    expect(
      view(
        run(
          { targetAmount: D('1000'), currency: 'USD' },
          {
            queryMonths: 3,
            observation: observed(
              { '2026-06': '100.01', '2026-07': '100.02', '2026-08': '100.02' },
              '2026-06',
              'USD',
            ),
          },
        ),
      ),
    ).toMatchObject({
      monthlyRequired: '333.34', // ceil(333.333...)
      availableMonthlyCashflow: '100.01', // floor(100.01666...)
      feasibilityScore: 30, // floor(30.0024...)
      status: 'NOT_RECOMMENDED',
    });
    expect(
      run(
        { targetAmount: D('1000'), currency: 'usd' },
        {
          observation: observed(
            { '2026-06': '-0.01', '2026-07': '-0.01', '2026-08': '-0.02' },
            '2026-06',
            'USD',
          ),
        },
      ).availableMonthlyCashflow?.toFixed(),
    ).toBe('-0.02'); // floor(-0.01333...)
  });

  it('VND rounds to whole dong even when stored amounts carry decimals', () => {
    expect(
      run(
        { targetAmount: D('10.5') },
        { queryMonths: 2 },
      ).monthlyRequired.toFixed(),
    ).toBe('6'); // ceil(5.25)
  });

  it('the largest stored amounts keep exact rounding', () => {
    expect(
      run(
        { targetAmount: D('9999999999999999.98'), currency: 'USD' },
        { queryMonths: 3 },
      ).monthlyRequired.toFixed(),
    ).toBe('3333333333333333.33'); // ceil(3,333,333,333,333,333.3266...)
  });

  it('fewer than two months with nothing remaining is still INSUFFICIENT_DATA (data-model step 6 precedes step 8)', () => {
    expect(
      view(
        run(
          { targetAmount: D(10_000_000), savedAmount: D(10_000_000) },
          { observation: observed({ '2026-08': 1 }) },
        ),
      ),
    ).toMatchObject({
      remainingAmount: '0',
      monthlyRequired: '0',
      pastDeadline: false,
      availableMonthlyCashflow: null,
      feasibilityScore: null,
      status: 'INSUFFICIENT_DATA',
      monthsRequired: 1,
      reason: 'INSUFFICIENT_HISTORY, TARGET_REACHED',
    });
  });

  it('a past deadline without enough history keeps the flag and the full amount due', () => {
    expect(
      view(
        run(
          {
            targetAmount: D(20_000_000),
            savedAmount: D(8_000_000),
            targetDate: new Date('2026-08-31'),
          },
          { observation: observed({}, null) },
        ),
      ),
    ).toMatchObject({
      months: 0,
      pastDeadline: true,
      monthlyRequired: '12000000',
      status: 'INSUFFICIENT_DATA',
      monthsRequired: 2,
      // Every applicable code is reported, in a fixed order.
      reason: 'INSUFFICIENT_HISTORY, PAST_DEADLINE',
    });
  });

  it('a date-only target date is the instant it is stored as (UTC midnight), read in the account timezone', () => {
    // 2026-10-01T00:00Z is still 30 September in New York, so the deadline is
    // the September user month: 1 period. Accounts east of UTC (all worked
    // examples) read the same calendar date.
    const newYork = { timeZone: 'America/New_York', monthStartDay: 1 };
    expect(
      run(
        { targetAmount: D(10_000_000), targetDate: new Date('2026-10-01') },
        { settings: newYork },
      ),
    ).toMatchObject({ horizonSource: 'TARGET_DATE', months: 1 });
    expect(
      run({ targetAmount: D(10_000_000), targetDate: new Date('2026-10-01') }),
    ).toMatchObject({ horizonSource: 'TARGET_DATE', months: 2 });
  });

  it('months follow the account month-start day (user months, DASH-002)', () => {
    // With day 25, 2026-09-23 lies in user month 2026-08 and 2026-12-15 in 2026-11.
    expect(
      run(
        { targetAmount: D(10_000_000), targetDate: new Date('2026-12-15') },
        { settings: { ...HCM, monthStartDay: 25 } },
      ),
    ).toMatchObject({ horizonSource: 'TARGET_DATE', months: 4 });
  });

  it('a target date beyond the supported calendar still counts its periods', () => {
    expect(
      run({ targetAmount: D(10_000_000), targetDate: new Date('2150-06-15') }),
    ).toMatchObject({ months: 1486 }); // 2026-09 through 2150-06
  });

  it('is pure: the same inputs give the same result and nothing is mutated', () => {
    const input = goal({
      targetAmount: D(45_000_000),
      savedAmount: D(5_000_000),
      targetDate: new Date('2026-12-15'),
    });
    const snapshot = JSON.stringify(input);
    const once = view(
      computeFeasibility({
        goal: input,
        now: NOW,
        observation: H1,
        userMonthPolicy: HCM,
      }),
    );
    const twice = view(
      computeFeasibility({
        goal: input,
        now: NOW,
        observation: H1,
        userMonthPolicy: HCM,
      }),
    );
    expect(twice).toEqual(once);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('observationWindow (T059)', () => {
  const keys = (earliest: string | null, now = NOW, settings = HCM) =>
    observationWindow(earliest ? new Date(earliest) : null, now, settings).map(
      (month) => month.key,
    );

  it.each([
    ['2026-09-05T08:00:00+07:00', []],
    ['2026-08-12T08:00:00+07:00', ['2026-08']],
    ['2026-07-01T00:00:00+07:00', ['2026-07', '2026-08']],
    ['2026-03-01T08:00:00+07:00', JUN_AUG],
  ])('G8 history starting %s observes %j', (earliest, expected) => {
    expect(keys(earliest)).toEqual(expected);
  });

  it('G9 starts at the history start month, empty months included', () => {
    expect(keys('2026-06-10T08:00:00+07:00')).toEqual(JUN_AUG);
  });

  it('no history, or history starting after now, observes nothing', () => {
    expect(keys(null)).toEqual([]);
    expect(keys('2026-10-02T08:00:00+07:00')).toEqual([]);
  });

  it('the history start is the user month in the account timezone', () => {
    // 2026-06-30T20:00Z is already 1 July in Ho Chi Minh City.
    expect(keys('2026-06-30T20:00:00Z')).toEqual(['2026-07', '2026-08']);
  });

  it('uses user months: with month-start day 25 the current month is 2026-08', () => {
    const day25 = { ...HCM, monthStartDay: 25 };
    expect(keys('2026-01-01T08:00:00+07:00', NOW, day25)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    const window = observationWindow(
      new Date('2026-07-26T08:00:00+07:00'),
      NOW,
      day25,
    );
    expect(window.map((month) => month.startDate)).toEqual(['2026-07-25']);
  });
});

// --- the service with a fake repository ---------------------------------------

type LedgerRow = {
  userId: string;
  currency: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  isDuplicate: boolean;
  amount: Prisma.Decimal;
  transactionTime: Date;
};

const row = (
  time: string,
  direction: TransactionDirection,
  amount: number | string,
  over: Partial<LedgerRow> = {},
): LedgerRow => ({
  userId: USER,
  currency: 'VND',
  direction,
  status: 'POSTED',
  isDuplicate: false,
  amount: D(amount),
  transactionTime: new Date(time),
  ...over,
});

/** H1 as persisted records, plus records that must not count. */
const H1_LEDGER: LedgerRow[] = [
  row('2025-01-10T08:00:00+07:00', 'EXPENSE', 50_000), // history start
  row('2026-06-05T08:00:00+07:00', 'INCOME', 9_000_000),
  row('2026-07-05T08:00:00+07:00', 'INCOME', 10_000_000),
  row('2026-07-20T08:00:00+07:00', 'EXPENSE', 2_000_000),
  row('2026-08-05T08:00:00+07:00', 'INCOME', 12_000_001),
  row('2026-08-20T08:00:00+07:00', 'EXPENSE', 2_000_000),
  // Current (incomplete) month and another currency never count.
  row('2026-09-05T08:00:00+07:00', 'INCOME', 99_000_000),
  row('2026-07-05T08:00:00+07:00', 'INCOME', 7_000, { currency: 'USD' }),
];

/**
 * The service's repository port. `observation` reproduces the two reads of
 * `completedMonthCashflow` over an in-memory ledger with the shared policy:
 * the earliest eligible record in the currency, then eligible income and
 * expense per window month (the real window function is used).
 */
class FakeGoalsRepository {
  goals: Goal[] = [];
  ledger: LedgerRow[] = [];

  findByIdForUser = jest.fn((userId: string, id: string) =>
    Promise.resolve(
      this.goals.find(
        (item) => item.id === id && item.userId === userId && !item.deletedAt,
      ) ?? null,
    ),
  );

  financialContext = jest.fn(() =>
    Promise.resolve({ settings: HCM, baseCurrency: 'VND' }),
  );

  observation = jest.fn(
    (
      userId: string,
      currency: string,
      now: Date,
      settings: PeriodSettings,
    ): Promise<CompletedMonthCashflow> => {
      const rows = this.ledger.filter(
        (item) =>
          item.userId === userId &&
          isEligibleTransaction(item) &&
          normalizeCurrency(item.currency) === normalizeCurrency(currency),
      );
      const earliest = rows.reduce<Date | null>(
        (min, item) =>
          !min || item.transactionTime < min ? item.transactionTime : min,
        null,
      );
      return Promise.resolve({
        currency: normalizeCurrency(currency),
        historyStartMonth: earliest
          ? userMonthContaining(earliest, settings).key
          : null,
        months: observationWindow(earliest, now, settings).map((month) => ({
          key: month.key,
          net: rows
            .filter(
              (item) =>
                CASHFLOW_DIRECTIONS.includes(item.direction) &&
                isInRange(item.transactionTime, month),
            )
            .reduce(
              (sum, item) =>
                item.direction === 'INCOME'
                  ? sum.plus(item.amount)
                  : sum.minus(item.amount),
              D(0),
            ),
        })),
      });
    },
  );
}

describe('GoalsService.simulate (T060, T061)', () => {
  let repository: FakeGoalsRepository;
  let service: GoalsService;
  const user = { id: USER, email: 'owner@example.test', role: 'USER' as const };

  beforeEach(async () => {
    repository = new FakeGoalsRepository();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: GoalsRepository, useValue: repository },
        { provide: Clock, useValue: { now: () => NOW } },
        { provide: AlertEvaluationService, useValue: alerts },
      ],
    }).compile();
    service = moduleRef.get(GoalsService);
  });

  const alerts = {
    onGoalChanged: jest.fn(),
    onTransactionsChanged: jest.fn(),
  };

  it('simulation is side-effect free: it never triggers alert evaluation (T082)', async () => {
    repository.goals = [goal({ targetDate: new Date('2026-12-15') })];
    repository.ledger = H1_LEDGER;
    await service.simulate(user, 'goal-1', {});
    await service.simulate(user, 'goal-1', { months: 3 });
    expect(alerts.onGoalChanged).not.toHaveBeenCalled();
    expect(alerts.onTransactionsChanged).not.toHaveBeenCalled();
  });

  it('G1 from persisted-style records: the contract fields, as plain numbers', async () => {
    repository.goals = [
      goal({
        targetAmount: D(45_000_000),
        savedAmount: D(5_000_000),
        targetDate: new Date('2026-12-15'),
      }),
    ];
    repository.ledger = H1_LEDGER;
    expect(await service.simulate(user, 'goal-1', {})).toEqual({
      goalId: 'goal-1',
      scenario: 'FULL',
      months: 4,
      horizonSource: 'TARGET_DATE',
      pastDeadline: false,
      targetAmount: 45_000_000,
      savedAmount: 5_000_000,
      remainingAmount: 40_000_000,
      totalCost: 40_000_000,
      monthlyRequired: 10_000_000,
      feasibilityScore: 90,
      status: 'ACCEPTABLE',
      availableMonthlyCashflow: 9_000_000,
      observationMonths: JUN_AUG,
      monthsRequired: 0,
      reason: 'COMPLETED_MONTHS_AVERAGE',
    });
    // The goal's currency and the controlled clock reach the observation.
    expect(repository.observation).toHaveBeenCalledWith(USER, 'VND', NOW, HCM);
  });

  it('G4 past deadline through the service', async () => {
    repository.goals = [
      goal({
        targetAmount: D(20_000_000),
        savedAmount: D(8_000_000),
        targetDate: new Date('2026-08-31'),
      }),
    ];
    repository.ledger = H1_LEDGER;
    expect(await service.simulate(user, 'goal-1', {})).toMatchObject({
      months: 0,
      pastDeadline: true,
      monthlyRequired: 12_000_000,
      feasibilityScore: 75,
      status: 'RISKY',
      reason: 'PAST_DEADLINE',
    });
  });

  it('G6 negative history through the service, with the what-if horizon', async () => {
    repository.goals = [goal({ targetAmount: D(20_000_000) })];
    repository.ledger = [
      row('2026-06-05T08:00:00+07:00', 'EXPENSE', 2_000_000),
      row('2026-07-05T08:00:00+07:00', 'EXPENSE', 1_000_000),
      row('2026-08-05T08:00:00+07:00', 'EXPENSE', 1_500_001),
    ];
    expect(await service.simulate(user, 'goal-1', { months: 2 })).toMatchObject(
      {
        months: 2,
        horizonSource: 'QUERY',
        monthlyRequired: 10_000_000,
        availableMonthlyCashflow: -1_500_001,
        feasibilityScore: 0,
        status: 'NOT_RECOMMENDED',
      },
    );
  });

  it.each([
    ['2026-09-05T08:00:00+07:00', [], 2],
    ['2026-08-12T08:00:00+07:00', ['2026-08'], 1],
  ])(
    'G8 history starting %s is INSUFFICIENT_DATA through the service',
    async (earliest, months, monthsRequired) => {
      repository.goals = [goal({ targetAmount: D(10_000_000) })];
      repository.ledger = [row(earliest, 'INCOME', 5_000_000)];
      expect(await service.simulate(user, 'goal-1', {})).toMatchObject({
        status: 'INSUFFICIENT_DATA',
        feasibilityScore: null,
        availableMonthlyCashflow: null,
        observationMonths: months,
        monthsRequired,
        reason: 'INSUFFICIENT_HISTORY',
      });
    },
  );

  it('G9 through the service: a month without records counts as 0', async () => {
    repository.goals = [goal({ targetAmount: D(10_000_000) })];
    repository.ledger = [
      row('2026-06-10T08:00:00+07:00', 'INCOME', 3_000_000),
      row('2026-08-10T08:00:00+07:00', 'INCOME', 6_000_000),
    ];
    expect(await service.simulate(user, 'goal-1', {})).toMatchObject({
      observationMonths: JUN_AUG,
      availableMonthlyCashflow: 3_000_000,
    });
  });

  it('INSTALLMENT is accepted without any inferred rate: the same result as FULL, and the reason says so', async () => {
    repository.goals = [
      goal({
        targetAmount: D(45_000_000),
        savedAmount: D(5_000_000),
        targetDate: new Date('2026-12-15'),
      }),
    ];
    repository.ledger = H1_LEDGER;
    const full = await service.simulate(user, 'goal-1', { scenario: 'FULL' });
    const installment = await service.simulate(user, 'goal-1', {
      scenario: 'INSTALLMENT',
    });
    expect(installment).toEqual({
      ...full,
      scenario: 'INSTALLMENT',
      reason: 'COMPLETED_MONTHS_AVERAGE, INSTALLMENT_WITHOUT_INTEREST',
    });
    expect(installment.totalCost).toBe(installment.remainingAmount);
  });

  it("another owner's goal, or an archived one, is not found", async () => {
    repository.goals = [
      goal({ userId: 'someone-else' }),
      goal({ id: 'goal-2', deletedAt: new Date('2026-09-01T00:00:00Z') }),
    ];
    await expect(service.simulate(user, 'goal-1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.simulate(user, 'goal-2', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findByIdForUser).toHaveBeenCalledWith(USER, 'goal-1');
  });
});

describe('no fixed financial capacity (GOAL-005, SC-008)', () => {
  const FIXED = /3[_,.]?900[_,.]?000|assumedFreeCashflow|1\.099/;

  it('the goals module and the Goals page hold no fixed income, expense, interest, or free-cashflow value', () => {
    const moduleFiles = readdirSync(__dirname, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));
    const goalsPage = join(
      __dirname,
      '../../../../web/src/features/goals/components/GoalsPage.tsx',
    );
    const offenders = [
      ...moduleFiles.map((file) => join(__dirname, file)),
      goalsPage,
    ].filter((file) => FIXED.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
