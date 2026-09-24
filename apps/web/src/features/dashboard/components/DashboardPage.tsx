import type { ReactNode } from "react";
import { Link } from "react-router";
import { Alert, Skeleton } from "antd";
import { useCustom } from "@refinedev/core";
import { AreaChart } from "@/components/charts/AreaChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { GaugeChart } from "@/components/charts/GaugeChart";
import { SparkLine } from "@/components/charts/SparkLine";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { describeApiError, mapTransactionRecord, type TransactionPayload } from "@/api/mappers";
import { formatMoney, formatMoneyShort, formatMonthKey, formatPeriod, formatSign } from "@/utils/format";

const colors = ["#b06fd6", "#d2604c", "#D97757", "#5b8def", "#8a8378", "#4a9d6e"];
const UNCATEGORIZED_COLOR = "#9c968d";
const DONUT_SLICES = 5;
const CASHFLOW_MONTHS = 6;

type CurrencyTotals = { currency: string; income: number; expense: number; netCashflow: number; transactionCount: number };
type Overview = CurrencyTotals & {
  month: string;
  savingRate: number;
  unreadAlerts: number;
  currencies: CurrencyTotals[];
  periodStart: string;
  periodEnd: string;
  /** The account IANA time zone the month periods are computed in. */
  timeZone?: string | null;
};
type CashflowMonth = { month: string; currency: string; income: number; expense: number; netCashflow: number };
type CategoryRef = { name?: string | null; color?: string | null } | null;
type BreakdownRow = { categoryId: string | null; category: CategoryRef; currency: string; amount: number; count: number };
type HotBudget = {
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
type Insight = { type: string; severity: string; title: string; message: string };
/**
 * The React Query state of one request. Its `data` is undefined until the first
 * success (refine's `result.data` is a frozen `{}` while pending or failed).
 */
type Call<T> = {
  query: { data?: { data: T }; isError: boolean; isFetching: boolean; error: unknown; refetch: () => Promise<unknown> };
};

const neutralDirectionLabels: Record<string, string> = {
  TRANSFER_IN: "Chuyển vào",
  TRANSFER_OUT: "Chuyển ra",
  ADJUSTMENT: "Điều chỉnh",
};

const severityColors: Record<string, string> = {
  CRITICAL: "#d2604c",
  WARNING: "#d99a3c",
  INFO: "#4a9d6e",
};

const EmptyBlock = ({ text }: { text: string }) => (
  <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-center text-[11.5px] text-[var(--muted)]">
    {text}
  </div>
);

const ErrorBlock = ({ text, onRetry, retrying }: { text: string; onRetry: () => void; retrying?: boolean }) => (
  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-center text-[11.5px] text-[var(--muted)]">
    <span>{text}</span>
    <Button onClick={onRetry} disabled={retrying}>
      {retrying ? "Đang thử lại..." : "Thử lại"}
    </Button>
  </div>
);

/**
 * Loading, error-with-retry, or the persisted data of one dashboard section
 * (ERR-005). A failed refresh keeps the last data and offers a retry.
 */
function renderSection<T>(call: Call<T>, label: string, render: (data: T) => ReactNode, rows = 3): ReactNode {
  const { query } = call;
  const data = query.data?.data;
  const retry = () => void query.refetch();

  if (data !== undefined && data !== null) {
    return (
      <>
        {query.isError && !query.isFetching && (
          <Alert
            className="mb-3"
            type="warning"
            showIcon
            message={`Không thể làm mới ${label}. ${describeApiError(query.error)}`}
            action={<Button onClick={retry}>Thử lại</Button>}
          />
        )}
        {render(data)}
      </>
    );
  }
  if (query.isError) {
    return <ErrorBlock text={`Không thể tải ${label}. ${describeApiError(query.error)}`} onRetry={retry} retrying={query.isFetching} />;
  }
  return <Skeleton active paragraph={{ rows }} title={false} />;
}

export function DashboardPage() {
  // One dashboard load (DASH-004): six requests for the current user month, sent
  // together with no month parameter. No request waits for the overview; the
  // sections render once the overview gives the base currency and time zone.
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

  const overview = overviewCall.query.data?.data;
  if (!overview) {
    const failed = overviewCall.query.isError;
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-3">
          {failed ? (
            <ErrorBlock
              text={`Không thể tải tổng quan tháng. ${describeApiError(overviewCall.query.error)}`}
              onRetry={() => void overviewCall.query.refetch()}
              retrying={overviewCall.query.isFetching}
            />
          ) : (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
        </Card>
        {!failed &&
          [0, 1, 2].map((index) => (
            <Card key={index}>
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </Card>
          ))}
      </div>
    );
  }

  const currency = overview.currency;
  const timeZone = overview.timeZone ?? undefined;
  const net = overview.netCashflow;
  const hasActivity = overview.transactionCount > 0;
  const otherCurrencies = overview.currencies.filter((group) => group.currency !== currency);
  const period = formatPeriod(overview.periodStart, overview.periodEnd, timeZone);
  const cashflow = cashflowCall.query.data?.data;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {overviewCall.query.isError && !overviewCall.query.isFetching && (
        <Alert
          className="xl:col-span-3"
          type="warning"
          showIcon
          message={`Không thể làm mới tổng quan. ${describeApiError(overviewCall.query.error)}`}
          action={<Button onClick={() => void overviewCall.query.refetch()}>Thử lại</Button>}
        />
      )}
      <Card accent className="xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--muted)]">
            <span className="h-4 w-1 rounded-full bg-[var(--accent)]" />
            Dòng tiền ròng · Tháng {formatMonthKey(overview.month)}
          </div>
          {hasActivity ? (
            <span
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
              style={{
                color: net >= 0 ? "var(--income)" : "var(--expense)",
                background: `color-mix(in srgb, ${net >= 0 ? "var(--income)" : "var(--expense)"} 12%, transparent)`,
              }}
            >
              {net >= 0 ? "Dòng tiền dương" : "Chi vượt thu"}
            </span>
          ) : (
            <span className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">Chưa có giao dịch</span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[clamp(30px,5vw,42px)] font-bold leading-none tabular-nums">
              {net > 0 ? "+" : ""}
              {formatMoney(net, currency)}
            </div>
            <p className="mt-3 max-w-[480px] text-[12px] text-[var(--muted)]">
              {period ? `${period} · ` : ""}
              {currency} · chỉ tính giao dịch đã ghi nhận, không trùng lặp; chuyển khoản và điều chỉnh không tính vào thu, chi.
            </p>
          </div>
          {cashflow && cashflow.length > 1 && (
            <SparkLine data={cashflow.map((item) => item.netCashflow)} color="#D97757" width={150} height={48} />
          )}
        </div>
        <div className="mt-5 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] text-[var(--faint)]">Tổng thu</div>
            <div className="mt-1 text-[15px] font-bold text-[var(--income)]">{formatMoney(overview.income, currency)}</div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--faint)]">Tổng chi</div>
            <div className="mt-1 text-[15px] font-bold text-[var(--expense)]">{formatMoney(overview.expense, currency)}</div>
          </div>
        </div>
        {otherCurrencies.length > 0 && (
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="text-[11px] font-semibold text-[var(--faint)]">Tiền tệ khác (không cộng vào tổng {currency})</div>
            <div className="mt-1.5 space-y-1 text-[11.5px]">
              {otherCurrencies.map((group) => (
                <div key={group.currency} className="flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
                  <b>{group.currency}</b>
                  <span className="text-[var(--income)]">Thu {formatMoney(group.income, group.currency)}</span>
                  <span className="text-[var(--expense)]">Chi {formatMoney(group.expense, group.currency)}</span>
                  <span>Ròng {formatMoney(group.netCashflow, group.currency)}</span>
                  <span className="text-[var(--faint)]">{group.transactionCount} giao dịch</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <Card className="flex flex-col items-center">
        <div className="flex w-full items-center justify-between text-[12.5px] font-bold">
          Tỷ lệ tiết kiệm
          <Link to="/app/goals" className="text-[11px] text-[var(--accent)]">
            Dự định
          </Link>
        </div>
        <GaugeChart pct={overview.savingRate} />
        <p className="text-center text-[11.5px] text-[var(--muted)]">
          {overview.income > 0 ? (
            <>
              Tháng {formatMonthKey(overview.month)}: <b className="text-[var(--text)]">{overview.savingRate}%</b> thu nhập
              {overview.savingRate < 0 ? " (chi vượt thu)" : ""}
            </>
          ) : (
            "Chưa có thu nhập trong tháng nên tỷ lệ tiết kiệm là 0%."
          )}
        </p>
      </Card>
      <Card>
        <div className="text-[11.5px] text-[var(--muted)]">Giao dịch được tính tháng này</div>
        <div className="mt-2 text-[22px] font-bold tabular-nums">{overview.transactionCount}</div>
        <div className="mt-1 text-[10.5px] text-[var(--faint)]">Mọi loại và mọi tiền tệ</div>
      </Card>
      <Card>
        <div className="text-[11.5px] text-[var(--muted)]">Cảnh báo chưa đọc</div>
        <div className="mt-2 text-[22px] font-bold tabular-nums text-[var(--warn)]">{overview.unreadAlerts}</div>
        <div className="mt-1 text-[10.5px] text-[var(--faint)]">Mức cảnh báo và nghiêm trọng</div>
      </Card>
      <Card>
        <div className="text-[11.5px] text-[var(--muted)]">Dòng tiền ròng</div>
        <div className="mt-2 text-[22px] font-bold tabular-nums text-[var(--accent)]">{formatMoney(net, currency)}</div>
        <div className="mt-1 text-[10.5px] text-[var(--faint)]">Thu trừ chi, {currency}</div>
      </Card>
      <Card className="xl:col-span-2">
        <SectionHeading title={`Dòng tiền ${CASHFLOW_MONTHS} tháng`} description={`Đến tháng ${formatMonthKey(overview.month)} · ${currency}`} />
        {renderSection(
          cashflowCall,
          "dòng tiền",
          (months) => (
            <>
              <AreaChart
                data={months.map((item) => ({ m: formatMonthKey(item.month), income: item.income, expense: item.expense }))}
                currency={currency}
              />
              {months.every((item) => item.income === 0 && item.expense === 0) && (
                <p className="mt-2 text-center text-[11px] text-[var(--faint)]">Chưa có thu hoặc chi được tính trong giai đoạn này.</p>
              )}
            </>
          ),
          6,
        )}
      </Card>
      <Card>
        <div className="mb-3 text-[13.5px] font-bold">Chi theo nhóm</div>
        {renderSection(breakdownCall, "chi theo nhóm", (rows) => {
          const baseRows = rows.filter((row) => row.currency === currency);
          const hasOtherCurrencies = rows.some((row) => row.currency !== currency);
          if (!baseRows.length) {
            return (
              <EmptyBlock
                text={
                  hasOtherCurrencies
                    ? `Chưa có khoản chi bằng ${currency} trong tháng. Chi bằng tiền tệ khác được hiển thị ở phần tổng quan.`
                    : "Chưa có khoản chi được tính trong tháng."
                }
              />
            );
          }
          const shown = baseRows.slice(0, DONUT_SLICES);
          const rest = baseRows.slice(DONUT_SLICES);
          const usedLabels = new Set<string>();
          const segments = [
            ...shown.map((row, index) => {
              const name = row.category?.name ?? (row.categoryId ? "Nhóm không xác định" : "Chưa phân loại");
              const label = usedLabels.has(name) ? `${name} (${index + 1})` : name;
              usedLabels.add(label);
              return {
                label,
                value: row.amount,
                color: row.categoryId ? (row.category?.color ?? colors[index % colors.length]) : UNCATEGORIZED_COLOR,
              };
            }),
            ...(rest.length
              ? [{ label: `${rest.length} nhóm khác`, value: rest.reduce((sum, row) => sum + row.amount, 0), color: "#c9c3b8" }]
              : []),
          ];
          // Categories marked "exclude from analytics" never appear here, so the
          // breakdown can total less than the month's expense, which still counts them.
          const breakdownTotal = Math.round(baseRows.reduce((sum, row) => sum + row.amount * 100, 0)) / 100;
          const hasExcludedCategories = overview.expense - breakdownTotal >= 0.005;
          return (
            <>
              <div className="relative flex justify-center [&_text]:hidden">
                <DonutChart segments={segments} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] text-[var(--muted)]">Chi theo nhóm</span>
                  <span className="text-[16px] font-bold tabular-nums">{formatMoneyShort(breakdownTotal, currency)}</span>
                </div>
              </div>
              {hasExcludedCategories && (
                <p className="mt-2 text-center text-[10.5px] leading-relaxed text-[var(--muted)]">
                  Không hiển thị các nhóm được loại khỏi phân tích; tổng chi của tháng vẫn gồm các khoản đó.
                </p>
              )}
              <div className="mt-3 space-y-1.5">
                {segments.map((segment) => (
                  <div key={segment.label} className="flex items-center gap-2 text-[11.5px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: segment.color }} />
                    <span className="min-w-0 flex-1 truncate">{segment.label}</span>
                    <span className="tabular-nums text-[var(--muted)]">
                      {breakdownTotal > 0 ? `${Math.round((segment.value / breakdownTotal) * 100)}%` : ""}
                    </span>
                    <b className="tabular-nums">{formatMoneyShort(segment.value, currency)}</b>
                  </div>
                ))}
              </div>
              {hasOtherCurrencies && (
                <p className="mt-3 text-[10.5px] text-[var(--faint)]">Chi bằng tiền tệ khác không có trong biểu đồ; xem phần tổng quan.</p>
              )}
            </>
          );
        })}
      </Card>
      <Card className="xl:col-span-2">
        <SectionHeading
          title="Giao dịch gần đây"
          action={
            <Link to="/app/transactions" className="text-[11.5px] font-semibold text-[var(--accent)]">
              Xem tất cả
            </Link>
          }
        />
        {renderSection(recentCall, "giao dịch gần đây", (items) => {
          const transactions = items.map((item) => mapTransactionRecord(item, timeZone));
          if (!transactions.length) return <EmptyBlock text="Chưa có giao dịch được tính trong tháng này." />;
          return (
            <div className="divide-y divide-[var(--border)]">
              {transactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className="h-9 w-9 shrink-0 rounded-[10px]"
                    style={{ background: `${transaction.categoryColor ?? "#8a8378"}22` }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold">{transaction.desc}</span>
                      {neutralDirectionLabels[transaction.direction] && (
                        <Badge color="#5b8def">{neutralDirectionLabels[transaction.direction]}</Badge>
                      )}
                    </div>
                    <div className="text-[10.5px] text-[var(--faint)]">
                      {transaction.time} · {transaction.bank}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-[12px] font-bold tabular-nums"
                      style={{ color: transaction.flow === "income" ? "var(--income)" : "var(--text)" }}
                    >
                      {formatSign(transaction.amount, transaction.flow, transaction.currency)}
                    </div>
                    <div className="text-[10px] text-[var(--faint)]">{transaction.categoryName ?? "Chưa phân loại"}</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </Card>
      <Card>
        <SectionHeading
          title="Ngân sách nóng"
          action={
            <Link to="/app/budgets" className="text-[11px] font-semibold text-[var(--accent)]">
              Xem
            </Link>
          }
        />
        {renderSection(hotBudgetsCall, "ngân sách", (budgets) =>
          budgets.length ? (
            <div className="space-y-4">
              {budgets.map((budget) => (
                <div key={budget.id}>
                  <div className="mb-1.5 flex justify-between gap-3 text-[11.5px]">
                    <span className="truncate">{budget.category?.name ?? budget.name}</span>
                    <b>{budget.percentUsed}%</b>
                  </div>
                  <ProgressBar value={budget.percentUsed} color={budget.percentUsed > 100 ? "var(--expense)" : "var(--warn)"} />
                  <div className="mt-1 text-[10px] text-[var(--faint)]">
                    {formatMoneyShort(budget.spent, budget.currency)} / {formatMoneyShort(budget.amount, budget.currency)} · ngưỡng{" "}
                    {budget.thresholdPercent}%
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock text="Chưa có ngân sách chạm ngưỡng cảnh báo trong tháng." />
          ),
        )}
      </Card>
      <Card className="xl:col-span-2">
        <SectionHeading title="Insight" description={`Theo quy tắc, từ dữ liệu tháng ${formatMonthKey(overview.month)}`} />
        {renderSection(insightsCall, "insight", (insights) =>
          insights.length ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {insights.map((item, index) => (
                <div key={`${item.type}-${index}`} className="rounded-xl bg-[var(--surface-2)] p-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: severityColors[item.severity] ?? "#8a8378" }} />
                    {item.title}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">{item.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock text="Chưa có insight cho tháng này." />
          ),
        )}
      </Card>
    </div>
  );
}
