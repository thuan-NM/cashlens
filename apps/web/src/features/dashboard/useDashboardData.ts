import { useCustom } from "@refinedev/core";
import type {
  CashflowMonth,
  CategoryBreakdownRow,
  CurrencyTotals,
  DashboardInsight,
  DashboardOverview,
  HotBudget,
  Transaction,
} from "@repo/api-contract";

/** Months shown by the cash-flow chart. */
export const CASHFLOW_MONTHS = 6;

// The dashboard responses, from the API contract.
export type { CashflowMonth, CurrencyTotals, DashboardInsight, HotBudget };
export type Overview = DashboardOverview;
export type BreakdownRow = CategoryBreakdownRow;
/** The category embedded in a breakdown row or hot budget; null when uncategorized. */
export type CategoryRef = CategoryBreakdownRow["category"];

/**
 * One dashboard load (DASH-004): six requests for the current user month, sent
 * together with no month parameter. No request waits for the overview; the page
 * renders each section once the overview gives the base currency and time zone.
 */
export function useDashboardData() {
  const overviewCall = useCustom<Overview>({ url: "/dashboard/overview", method: "get" });
  const cashflowCall = useCustom<CashflowMonth[]>({
    url: "/dashboard/cashflow",
    method: "get",
    config: { query: { months: CASHFLOW_MONTHS } },
  });
  const breakdownCall = useCustom<BreakdownRow[]>({ url: "/dashboard/category-breakdown", method: "get" });
  const recentCall = useCustom<Transaction[]>({ url: "/dashboard/recent-transactions", method: "get" });
  const hotBudgetsCall = useCustom<HotBudget[]>({ url: "/dashboard/hot-budgets", method: "get" });
  const insightsCall = useCustom<DashboardInsight[]>({ url: "/dashboard/insights", method: "get" });

  return { overviewCall, cashflowCall, breakdownCall, recentCall, hotBudgetsCall, insightsCall };
}
