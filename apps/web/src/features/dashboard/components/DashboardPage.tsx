import { Link } from "react-router";
import { AreaChart } from "@/components/charts/AreaChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { GaugeChart } from "@/components/charts/GaugeChart";
import { SparkLine } from "@/components/charts/SparkLine";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUDGETS, MONTHS, TRANSACTIONS, getCat } from "@/config/mockData";
import { formatMoney, formatMoneyShort, formatSign } from "@/utils/format";

const donutSegments = [
  { label: "Mua sắm", value: 6889000, color: "#b06fd6" },
  { label: "Hóa đơn", value: 2482000, color: "#d2604c" },
  { label: "Ăn uống", value: 1870000, color: "#D97757" },
  { label: "Di chuyển", value: 980000, color: "#5b8def" },
  { label: "Khác", value: 1620000, color: "#8a8378" },
];

const stats = [
  { label: "Thu trung bình 6T", value: "26.916.667₫", sub: "+5,7% so với T5", color: "var(--income)", series: MONTHS.map((item) => item.income) },
  { label: "Chi trung bình 6T", value: "20.600.000₫", sub: "+2,5% so với T5", color: "var(--expense)", series: MONTHS.map((item) => item.expense) },
  { label: "Giao dịch tháng này", value: "128", sub: "31 từ email tự động", color: "var(--text)", series: [98, 104, 112, 119, 121, 128] },
];

export function DashboardPage() {
  const income = 28000000;
  const expense = 20800000;
  const net = income - expense;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card accent className="xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--muted)]"><span className="h-4 w-1 rounded-full bg-[var(--accent)]" />Số dư ròng · Tháng 6, 2026</div>
          <span className="rounded-lg bg-[color-mix(in_srgb,var(--income)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--income)]">Dòng tiền dương</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[clamp(30px,5vw,42px)] font-bold leading-none tracking-[-.035em] tabular-nums">+{formatMoney(net)}</div>
            <p className="font-editorial mt-3 max-w-[480px] text-[15.5px] italic leading-relaxed text-[var(--muted)]">Bạn đang tiêu ít hơn <b className="text-[var(--accent)]">8%</b> so với tháng trước — giữ đà này, mục tiêu tiết kiệm sẽ đến sớm hơn một tháng.</p>
          </div>
          <SparkLine data={MONTHS.map((item) => item.income - item.expense)} color="#D97757" width={150} height={48} />
        </div>
        <div className="mt-5 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <div><div className="text-[11px] text-[var(--faint)]">Tổng thu</div><div className="mt-1 text-[15px] font-bold text-[var(--income)]">{formatMoney(income)}</div></div>
          <div><div className="text-[11px] text-[var(--faint)]">Tổng chi</div><div className="mt-1 text-[15px] font-bold text-[var(--expense)]">{formatMoney(expense)}</div></div>
        </div>
      </Card>
      <Card className="flex flex-col items-center">
        <div className="flex w-full items-center justify-between text-[12.5px] font-bold">Tỷ lệ tiết kiệm<Link to="/app/goals" className="text-[11px] text-[var(--accent)]">Dự định →</Link></div>
        <GaugeChart pct={26} />
        <p className="text-[11.5px] text-[var(--muted)]">Mục tiêu 30% · còn <b className="text-[var(--text)]">4 điểm</b></p>
      </Card>
      {stats.map((stat) => (
        <Card key={stat.label} hover>
          <div className="flex items-start justify-between gap-2"><div className="text-[11.5px] font-medium text-[var(--muted)]">{stat.label}</div><SparkLine data={stat.series} color={stat.color} width={64} height={26} /></div>
          <div className="mt-2 text-[20.5px] font-bold tracking-tight tabular-nums" style={{ color: stat.color }}>{stat.value}</div>
          <div className="mt-1 text-[11px] text-[var(--faint)]">{stat.sub}</div>
        </Card>
      ))}
      <Card className="xl:col-span-2">
        <SectionHeading title="Dòng tiền 6 tháng" />
        <div className="mb-1 flex justify-end gap-4 text-[11px] text-[var(--muted)]"><span>● <b className="text-[var(--income)]">Thu</b></span><span>● <b className="text-[var(--expense)]">Chi</b></span></div>
        <AreaChart data={MONTHS} />
      </Card>
      <Card>
        <div className="text-[13.5px] font-bold">Chi theo nhóm</div>
        <div className="flex justify-center"><DonutChart segments={donutSegments} /></div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
          {donutSegments.map((item) => <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}
        </div>
      </Card>
      <Card className="xl:col-span-2">
        <SectionHeading title="Giao dịch gần đây" action={<Link to="/app/transactions" className="text-[11.5px] font-semibold text-[var(--accent)]">Xem tất cả →</Link>} />
        <div className="divide-y divide-[var(--border)]">
          {TRANSACTIONS.slice(0, 5).map((transaction) => {
            const category = getCat(transaction.cat);
            return (
              <div key={transaction.id} className="flex items-center gap-3 py-2.5">
                <span className="h-9 w-9 rounded-[10px]" style={{ background: `${category.color}22` }} />
                <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-semibold">{transaction.desc}</div><div className="text-[10.5px] text-[var(--faint)]">{transaction.time} · {transaction.bank}</div></div>
                <div className="text-right"><div className="text-[12px] font-bold tabular-nums" style={{ color: transaction.dir === "income" ? "var(--income)" : "var(--text)" }}>{formatSign(transaction.amount, transaction.dir)}</div><div className="text-[10px] text-[var(--faint)]">{category.name}</div></div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <SectionHeading title="Ngân sách nóng" action={<Link to="/app/budgets" className="text-[11px] font-semibold text-[var(--accent)]">Xem →</Link>} />
        <div className="space-y-4">
          {BUDGETS.filter((budget) => budget.spent / budget.limit >= 0.85).map((budget) => {
            const category = getCat(budget.cat);
            const percent = Math.round((budget.spent / budget.limit) * 100);
            return <div key={budget.cat}><div className="mb-1.5 flex justify-between text-[11.5px]"><span>{category.name}</span><b style={{ color: percent > 100 ? "var(--expense)" : "var(--warn)" }}>{percent}%</b></div><ProgressBar value={percent} color={percent > 100 ? "var(--expense)" : "var(--warn)"} /><div className="mt-1 text-[10px] text-[var(--faint)]">{formatMoneyShort(budget.spent)} / {formatMoneyShort(budget.limit)}</div></div>;
          })}
        </div>
      </Card>
      <Card className="xl:col-span-2">
        <SectionHeading title="AI insight tháng 6" description="Tạo từ dữ liệu đã tổng hợp · không tính toán số tiền" />
        <p className="font-editorial my-4 text-[15px] italic text-[var(--muted)]">“Tháng này dòng tiền của bạn vẫn dương, nhưng có hai điểm đáng chú ý nên xử lý sớm.”</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[["Mua sắm vượt ngân sách", "Một giao dịch lớn 6,5tr khiến nhóm đạt 109%.", "var(--expense)"], ["Cà phê đang tăng dần", "Đã dùng 89% ngân sách khi còn nửa tháng.", "var(--warn)"], ["Tỷ lệ tiết kiệm tốt", "Bạn giữ 26% thu nhập, chỉ kém mục tiêu 4 điểm.", "var(--income)"]].map((item) => <div key={item[0]} className="rounded-xl bg-[var(--surface-2)] p-3"><div className="flex items-center gap-2 text-[12px] font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: item[2] }} />{item[0]}</div><p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">{item[1]}</p></div>)}
        </div>
      </Card>
    </div>
  );
}
