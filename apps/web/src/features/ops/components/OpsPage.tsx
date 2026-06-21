import { SparkLine } from "@/components/charts/SparkLine";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { OPS_KPIS } from "@/config/mockData";

const banks = [
  ["VCB", "Vietcombank", "no-reply@info.vietcombank.com.vn", "vcb-balance-v2", "Hoạt động", "var(--income)"],
  ["TCB", "Techcombank", "service@techcombank.com.vn", "tcb-txn-v1", "Hoạt động", "var(--income)"],
  ["MB", "MB Bank", "no-reply@mbbank.com.vn", "mb-balance-v1", "Hoạt động", "var(--income)"],
  ["ACB", "ACB", "notify@acb.com.vn", "acb-card-v1", "Suy giảm", "var(--warn)"],
  ["CTG", "VietinBank", "—", "chưa hỗ trợ", "Kế hoạch", "var(--faint)"],
];

export function OpsPage() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{OPS_KPIS.map((item) => <Card key={item.label} hover><div className="flex items-start justify-between gap-3"><div className="text-[11.5px] font-medium text-[var(--muted)]">{item.label}</div><SparkLine data={item.series} color={item.color} width={64} height={25} /></div><div className="mt-2 text-[21px] font-bold" style={{ color: item.color }}>{item.value}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{item.sub}</div></Card>)}</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding="p-4"><SectionHeading title="Nhà cung cấp ngân hàng" description="Catalog sender & parser template" /><div className="divide-y divide-[var(--border)]">{banks.map((bank) => <div key={bank[0]} className="grid grid-cols-[1fr_auto] gap-3 py-3 sm:grid-cols-[1fr_1.4fr_1fr_auto]"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-3)] text-[10px] font-bold">{bank[0]}</span><b className="text-[11.5px]">{bank[1]}</b></div><span className="hidden truncate text-[10.5px] text-[var(--faint)] sm:block">{bank[2]}</span><code className="hidden text-[10px] text-[var(--muted)] sm:block">{bank[3]}</code><span className="text-[10.5px] font-semibold" style={{ color: bank[5] }}>{bank[4]}</span></div>)}</div></Card>
        <Card padding="p-4"><SectionHeading title="Sự kiện pipeline gần đây" description="Sync · parser · classification · notification" /><div className="divide-y divide-[var(--border)]">{[["08:15:02", "Sync VCB hoàn tất · 12 email · +8 giao dịch", "var(--income)"], ["08:14:51", "Parser tcb-txn-v1 cảnh báo: thiếu balance_after", "var(--warn)"], ["08:14:30", 'Classification rule "GRAB" khớp 2 giao dịch', "var(--income)"], ["07:48:10", "ACB acb-card-v1 lỗi parse: định dạng số tiền lạ", "var(--expense)"], ["07:30:00", "Notification delivery gửi 3 alert thành công", "var(--income)"]].map((event) => <div key={event[0]} className="flex gap-3 py-3 text-[11px]"><code className="text-[var(--faint)]">{event[0]}</code><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: event[2] }} /><span className="leading-relaxed text-[var(--muted)]">{event[1]}</span></div>)}</div></Card>
      </div>
    </div>
  );
}
