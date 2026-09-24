/** A budget as the API returns it (`GET /budgets`). */
export interface ApiBudget {
  id: string;
  categoryId?: string | null;
  name?: string;
  amount?: number | string;
  currency?: string;
  period?: string;
  thresholdPercent?: number;
  warningThresholdActive?: boolean;
  alertsSupported?: boolean;
  usageBasis?: string;
  usage?: { spent?: number; percentUsed?: number; isNearThreshold?: boolean; isOverLimit?: boolean };
}

/** `GET /budgets/summary`: totals of the base-currency budgets. */
export interface ApiBudgetSummary {
  currency?: string;
  totalLimit?: number;
  totalSpent?: number;
}

export interface Budget {
  id: string;
  cat: string | null;
  name: string;
  limit: number;
  spent: number;
  percentUsed: number;
  threshold: number;
  currency: string;
  period: string;
  /** false for a legacy threshold of 100% or more: only the 100% alert applies. */
  warningThresholdActive: boolean;
  /** Alerts cover MONTHLY budgets only (BUDGET-005). */
  alertsSupported: boolean;
  /** PERIOD_INSTANCE for MONTHLY budgets; the calendar-month projection otherwise. */
  usageBasis: string;
  isNearThreshold: boolean;
  isOverLimit: boolean;
}
