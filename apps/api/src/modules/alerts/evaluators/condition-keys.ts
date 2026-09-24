/**
 * Condition key formats (data-model "Condition key formats"): stable, ASCII,
 * no sensitive values. The prefixes let an evaluator find its own open keys
 * whose targets are gone (stale-key sweeps).
 */
export const KEY_PREFIX = {
  budget: 'budget:',
  largeTransaction: 'large-tx:',
  goal: 'goal:',
  cashflow: 'cashflow:',
  syncFailure: 'sync-failure:',
  reconnect: 'reconnect:',
} as const;

export type BudgetSeverityTier = 'WARNING' | 'CRITICAL';

export const budgetKey = (
  budgetId: string,
  instanceStartDate: string,
  tier: BudgetSeverityTier,
) => `${KEY_PREFIX.budget}${budgetId}:${instanceStartDate}:${tier}`;

/** `budget:{id}:{YYYY-MM-DD}:{tier}`; null for anything else. */
export const parseBudgetKey = (key: string) => {
  const match = /^budget:([^:]+):(\d{4}-\d{2}-\d{2}):(WARNING|CRITICAL)$/.exec(
    key,
  );
  return match
    ? {
        budgetId: match[1],
        instanceStartDate: match[2],
        tier: match[3] as BudgetSeverityTier,
      }
    : null;
};

export const largeTransactionKey = (transactionId: string) =>
  `${KEY_PREFIX.largeTransaction}${transactionId}`;
export const goalKey = (goalId: string) => `${KEY_PREFIX.goal}${goalId}`;
export const cashflowKey = (userId: string) =>
  `${KEY_PREFIX.cashflow}${userId}`;
export const syncFailureKey = (connectionId: string) =>
  `${KEY_PREFIX.syncFailure}${connectionId}`;
export const reconnectKey = (connectionId: string) =>
  `${KEY_PREFIX.reconnect}${connectionId}`;

/** The id after a single-id prefix (`goal:{id}` and the like). */
export const idOfKey = (key: string, prefix: string) =>
  key.startsWith(prefix) ? key.slice(prefix.length) : null;
