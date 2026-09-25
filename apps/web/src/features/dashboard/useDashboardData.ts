import { useCustom } from "@refinedev/core";
import type { TransactionPayload } from "@/api/mappers";

/** Months shown by the cash-flow chart. */
export const CASHFLOW_MONTHS = 6;

export type CurrencyTotals = { currency: string; income: number; expense: number; netCashflow: number; transactionCount: number };
export type Overview = CurrencyTotals & {
  month: string;
  savingRate: number;
  unreadAlerts: number;
  currencies: CurrencyTotals[];
  periodStart: string;
  periodEnd: string;
  /** The account IANA time zone the month periods are computed in. */
  timeZone?: string | null;
};
export type CashflowMonth = { month: string; currency: string; income: number; expense: number; netCashflow: number };
export type CategoryRef = { name?: string | null; color?: string | null } | null;
export type BreakdownRow = { categoryId: string | null; category: CategoryRef; currency: string; amount: number; count: number };
export type HotBudget = {
  id: string;
  categoryId: string | null;
  name: string;
  currency: string;
  amount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  thresholdPercent: number;
  category: CategoryRef;
};
export type Insight = { type: string; severity: string; title: string; message: string };
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
  const recentCall = useCustom<TransactionPayload[]>({ url: "/dashboard/recent-transactions", method: "get" });
  const hotBudgetsCall = useCustom<HotBudget[]>({ url: "/dashboard/hot-budgets", method: "get" });
  const insightsCall = useCustom<Insight[]>({ url: "/dashboard/insights", method: "get" });

  return { overviewCall, cashflowCall, breakdownCall, recentCall, hotBudgetsCall, insightsCall };
}
