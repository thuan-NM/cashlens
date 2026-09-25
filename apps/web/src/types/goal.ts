import type { Goal as ContractGoal, GoalFeasibility as ContractGoalFeasibility } from "@repo/api-contract";

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

/** A goal as the API returns it (`GET /goals`): the API contract's `Goal`. */
export type ApiGoal = ContractGoal;

/** `GET /goals/:id/simulation` (contract `GoalFeasibility`): every number comes from the API. */
export type GoalFeasibility = ContractGoalFeasibility;
export type GoalHorizonSource = GoalFeasibility["horizonSource"];
export type GoalFeasibilityStatus = GoalFeasibility["status"];
