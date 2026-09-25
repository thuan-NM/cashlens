export interface Goal {
  id: string;
  name: string;
  type: string;
  target: number;
  saved: number;
  date: string;
  /** Planned duration in months; null when the goal has none. */
  months: number | null;
  priority: string;
  currency?: string;
  /** Never negative: max(0, target − saved), computed by the API. */
  remaining?: number;
}

/** A goal as the API returns it (`GET /goals`). */
export interface ApiGoal {
  id: string;
  name: string;
  type: string;
  targetAmount?: number | string;
  savedAmount?: number | string;
  remainingAmount?: number | string;
  progressPercent?: number;
  currency?: string;
  targetDate?: string | null;
  months?: number | null;
  priority?: string;
  status?: string;
}

export type GoalHorizonSource = "QUERY" | "TARGET_DATE" | "GOAL_MONTHS" | "DEFAULT";
export type GoalFeasibilityStatus = "SAFE" | "ACCEPTABLE" | "RISKY" | "NOT_RECOMMENDED" | "INSUFFICIENT_DATA";

/** `GET /goals/:id/simulation` (contract `GoalFeasibility`): every number comes from the API. */
export interface GoalFeasibility {
  goalId: string;
  scenario?: string;
  /** Remaining periods: user months from the current one through the deadline month. */
  months: number;
  horizonSource: GoalHorizonSource;
  pastDeadline: boolean;
  targetAmount: number;
  savedAmount: number;
  remainingAmount: number;
  totalCost?: number;
  monthlyRequired: number;
  /** Null when there is not enough history. */
  feasibilityScore: number | null;
  status: GoalFeasibilityStatus;
  availableMonthlyCashflow: number | null;
  observationMonths: string[];
  monthsRequired: number;
  reason: string;
}
