/**
 * The budget threshold rule lives in `common/finance` so the alert evaluator
 * and the dashboard share it without importing the budgets feature
 * (plan.md "Alert module dependency direction"). Re-exported here for the
 * budgets module and its spec.
 */
export * from '../../common/finance/budget-threshold.policy';
