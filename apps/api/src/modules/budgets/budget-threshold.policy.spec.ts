import {
  CRITICAL_THRESHOLD_PERCENT,
  budgetThresholdState,
  isWarningThresholdActive,
} from './budget-threshold.policy';

/**
 * BUDGET-001, BUDGET-004 (T069): the one threshold rule shared by the budget
 * evaluator, `usage.isNearThreshold`, `GET /budgets/alerts`, and the
 * dashboard's hot budgets.
 */
describe('budget threshold policy (T069)', () => {
  it('fixes the critical threshold at 100%', () => {
    expect(CRITICAL_THRESHOLD_PERCENT).toBe(100);
  });

  it.each([
    [1, true],
    [80, true],
    [99, true],
    [100, false],
    [150, false],
    [200, false],
    [0, false],
  ])('warning threshold %p is active: %p', (threshold, active) => {
    expect(isWarningThresholdActive(threshold)).toBe(active);
  });

  it('holds the warning at exactly the threshold, not one unit below', () => {
    expect(
      budgetThresholdState({ thresholdPercent: 80, amount: 1000, spent: 800 }),
    ).toMatchObject({ warning: true, critical: false, isNearThreshold: true });
    expect(
      budgetThresholdState({
        thresholdPercent: 80,
        amount: 1000,
        spent: '799.99',
      }),
    ).toMatchObject({
      warning: false,
      critical: false,
      isNearThreshold: false,
    });
  });

  it('holds critical at exactly 100%, not one unit below', () => {
    expect(
      budgetThresholdState({ thresholdPercent: 80, amount: 1000, spent: 1000 }),
    ).toMatchObject({ warning: true, critical: true });
    expect(
      budgetThresholdState({
        thresholdPercent: 80,
        amount: 1000,
        spent: '999.99',
      }),
    ).toMatchObject({ warning: true, critical: false });
  });

  it('compares exactly: 79.999% is not 80% even though it rounds to 80', () => {
    const state = budgetThresholdState({
      thresholdPercent: 80,
      amount: 100000,
      spent: '79999',
    });
    expect(state.percentUsed?.toString()).toBe('79.999');
    expect(state.warning).toBe(false);
  });

  it('holds warning and critical independently for one large jump', () => {
    expect(
      budgetThresholdState({ thresholdPercent: 80, amount: 1000, spent: 1500 }),
    ).toMatchObject({
      warningThresholdActive: true,
      warning: true,
      critical: true,
      isNearThreshold: true,
    });
  });

  it('treats a legacy threshold of 100 or more as no warning, still evaluating critical (BUDGET-004)', () => {
    for (const legacy of [100, 120, 200]) {
      expect(
        budgetThresholdState({
          thresholdPercent: legacy,
          amount: 1000,
          spent: 999,
        }),
      ).toMatchObject({
        warningThresholdActive: false,
        warning: false,
        critical: false,
        isNearThreshold: false,
      });
      expect(
        budgetThresholdState({
          thresholdPercent: legacy,
          amount: 1000,
          spent: 1000,
        }),
      ).toMatchObject({
        warningThresholdActive: false,
        warning: false,
        critical: true,
        isNearThreshold: true,
      });
    }
  });

  it('has no usage percentage for a zero amount, so nothing holds', () => {
    expect(
      budgetThresholdState({ thresholdPercent: 80, amount: 0, spent: 10 }),
    ).toEqual({
      percentUsed: null,
      warningThresholdActive: true,
      warning: false,
      critical: false,
      isNearThreshold: false,
    });
  });

  it('holds nothing when nothing was spent', () => {
    expect(
      budgetThresholdState({ thresholdPercent: 1, amount: 1000, spent: 0 }),
    ).toMatchObject({ warning: false, critical: false });
  });
});
