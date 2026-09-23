import { Link } from "react-router";
import { useCustom } from "@refinedev/core";
import { AreaChart } from "@/components/charts/AreaChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { GaugeChart } from "@/components/charts/GaugeChart";
import { SparkLine } from "@/components/charts/SparkLine";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { mapTransaction } from "@/api/mappers";
import { formatMoney, formatMoneyShort, formatSign } from "@/utils/format";

const colors = ["#b06fd6", "#d2604c", "#D97757", "#5b8def", "#8a8378", "#4a9d6e"];
const emptyCashflow = Array.from({ length: 6 }, (_, index) => ({ month: `T${index + 1}`, income: 0, expense: 0, netCashflow: 0 }));

const EmptyBlock = ({ text }: { text: string }) => (
  <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4 text-center text-[11.5px] text-[var(--muted)]">
    {text}
  </div>
);

const toArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }

  return [];
};

const unwrapObject = <T,>(value: unknown): T | undefined => {
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value && !("month" in value)) {
    return (value as { data: T }).data;
  }

  return value as T | undefined;
};

export function DashboardPage() {
  const { result: overviewResult } = useCustom<any>({ url: "/dashboard/overview", method: "get" });
  const { result: cashflowResult } = useCustom<any[]>({ url: "/dashboard/cashflow", method: "get", config: { query: { months: 6 } } });
  const { result: breakdownResult } = useCustom<any[]>({ url: "/dashboard/category-breakdown", method: "get" });
  const { result: recentResult } = useCustom<any[]>({ url: "/dashboard/recent-transactions", method: "get" });
  const { result: hotBudgetsResult } = useCustom<any[]>({ url: "/dashboard/hot-budgets", method: "get" });
  const { result: insightsResult } = useCustom<any[]>({ url: "/dashboard/insights", method: "get" });

  const overview = unwrapObject<any>(overviewResult?.data);
  const cashflowData = toArray<any>(cashflowResult?.data);
  const breakdownData = toArray<any>(breakdownResult?.data);
  const recentData = toArray<any>(recentResult?.data);
  const hotBudgetData = toArray<any>(hotBudgetsResult?.data);
  const insightData = toArray<any>(insightsResult?.data);
  const cashflow = cashflowData.length ? cashflowData : emptyCashflow;
  const income = Number(overview?.income ?? 0);
  const expense = Number(overview?.expense ?? 0);
  const net = Number(overview?.netCashflow ?? income - expense);
  const savingRate = Number(overview?.savingRate ?? 0);
  const recentTransactions = recentData.map(mapTransaction);
  const hotBudgets = hotBudgetData;
  const insights = insightData;
  const donut = breakdownData.slice(0, 6).map((item, index) => ({
    label: item.category?.name ?? "Khác",
    value: Number(item.amount ?? 0),
    color: item.category?.color ?? colors[index % colors.length],
  }));
  const chartMonths = cashflow.map((item) => ({ m: item.month, income: item.income, expense: item.expense }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card accent className="xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--muted)]"><span className="h-4 w-1 rounded-full bg-[var(--accent)]" />Số dư ròng</div>
          <span className="rounded-lg bg-[color-mix(in_srgb,var(--income)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--income)]">{net >= 0 ? "Dòng tiền dương" : "Cần theo dõi"}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[clamp(30px,5vw,42px)] font-bold leading-none tabular-nums">{net >= 0 ? "+" : ""}{formatMoney(net)}</div>
            <p className="font-editorial mt-3 max-w-[480px] text-[15.5px] italic leading-relaxed text-[var(--muted)]">Dữ liệu tổng hợp trực tiếp từ API CashLens.</p>
          </div>
          <SparkLine data={cashflow.map((item) => item.netCashflow)} color="#D97757" width={150} height={48} />
        </div>
        <div className="mt-5 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <div><div className="text-[11px] text-[var(--faint)]">Tổng thu</div><div className="mt-1 text-[15px] font-bold text-[var(--income)]">{formatMoney(income)}</div></div>
          <div><div className="text-[11px] text-[var(--faint)]">Tổng chi</div><div className="mt-1 text-[15px] font-bold text-[var(--expense)]">{formatMoney(expense)}</div></div>
        </div>
      </Card>
      <Card className="flex flex-col items-center">
        <div className="flex w-full items-center justify-between text-[12.5px] font-bold">Tỷ lệ tiết kiệm<Link to="/app/goals" className="text-[11px] text-[var(--accent)]">Dự định</Link></div>
        <GaugeChart pct={Math.max(0, Math.min(100, savingRate))} />
        <p className="text-[11.5px] text-[var(--muted)]">Mục tiêu 30% · hiện tại <b className="text-[var(--text)]">{savingRate}%</b></p>
      </Card>
      <Card><div className="text-[11.5px] text-[var(--muted)]">Giao dịch tháng này</div><div className="mt-2 text-[22px] font-bold tabular-nums">{overview?.transactionCount ?? recentTransactions.length}</div></Card>
      <Card><div className="text-[11.5px] text-[var(--muted)]">Cảnh báo chưa đọc</div><div className="mt-2 text-[22px] font-bold tabular-nums text-[var(--warn)]">{overview?.unreadAlerts ?? 0}</div></Card>
      <Card><div className="text-[11.5px] text-[var(--muted)]">Dòng tiền ròng</div><div className="mt-2 text-[22px] font-bold tabular-nums text-[var(--accent)]">{formatMoney(net)}</div></Card>
      <Card className="xl:col-span-2"><SectionHeading title="Dòng tiền 6 tháng" /><AreaChart data={chartMonths} /></Card>
      <Card><div className="text-[13.5px] font-bold">Chi theo nhóm</div>{donut.length ? <div className="flex justify-center"><DonutChart segments={donut} /></div> : <EmptyBlock text="Chưa có dữ liệu chi tiêu theo nhóm." />}</Card>
      <Card className="xl:col-span-2">
        <SectionHeading title="Giao dịch gần đây" action={<Link to="/app/transactions" className="text-[11.5px] font-semibold text-[var(--accent)]">Xem tất cả</Link>} />
        {recentTransactions.length ? <div className="divide-y divide-[var(--border)]">{recentTransactions.map((transaction) => <div key={transaction.id} className="flex items-center gap-3 py-2.5"><span className="h-9 w-9 rounded-[10px] bg-[var(--surface-3)]" /><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold">{transaction.desc}</div><div className="text-[10.5px] text-[var(--faint)]">{transaction.time} · {transaction.bank}</div></div><div className="text-right"><div className="text-[12px] font-bold tabular-nums" style={{ color: transaction.dir === "income" ? "var(--income)" : "var(--text)" }}>{formatSign(transaction.amount, transaction.dir)}</div><div className="text-[10px] text-[var(--faint)]">{transaction.cat === "unknown" ? "Chưa phân loại" : "Đã phân loại"}</div></div></div>)}</div> : <EmptyBlock text="Chưa có giao dịch từ API." />}
      </Card>
      <Card><SectionHeading title="Ngân sách nóng" action={<Link to="/app/budgets" className="text-[11px] font-semibold text-[var(--accent)]">Xem</Link>} />{hotBudgets.length ? <div className="space-y-4">{hotBudgets.map((budget: any) => { const cat = budget.category ?? { name: budget.name ?? "Ngân sách", color: "var(--warn)" }; const spent = Number(budget.spent ?? budget.usage?.spent ?? 0); const limit = Number(budget.amount ?? budget.limit ?? 1); const percent = Math.round((spent / limit) * 100); return <div key={budget.id ?? budget.categoryId}><div className="mb-1.5 flex justify-between text-[11.5px]"><span>{cat.name}</span><b>{percent}%</b></div><ProgressBar value={percent} color={percent > 100 ? "var(--expense)" : "var(--warn)"} /><div className="mt-1 text-[10px] text-[var(--faint)]">{formatMoneyShort(spent)} / {formatMoneyShort(limit)}</div></div>; })}</div> : <EmptyBlock text="Chưa có ngân sách vượt ngưỡng." />}</Card>
      <Card className="xl:col-span-2"><SectionHeading title="Insight" description="Rule-based từ backend" /><div className="grid gap-3 sm:grid-cols-3">{(insights.length ? insights : [{ title: "Dữ liệu sẵn sàng", message: "Kết nối API đã hoạt động. Thêm giao dịch để có insight chi tiết." }]).map((item: any) => <div key={item.title} className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-[12px] font-semibold">{item.title}</div><p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">{item.message}</p></div>)}</div></Card>
    </div>
  );
}
