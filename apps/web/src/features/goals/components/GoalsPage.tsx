import { useMemo, useState } from "react";
import { Form, Input, Modal, Segmented, Slider } from "antd";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GOALS } from "@/config/mockData";
import { formatMoney, formatMoneyShort } from "@/utils/format";

export function GoalsPage() {
  const [selected, setSelected] = useState(GOALS[0]);
  const [months, setMonths] = useState(selected.months);
  const [scenario, setScenario] = useState("full");
  const [open, setOpen] = useState(false);
  const monthly = useMemo(() => Math.max(0, (selected.target - selected.saved) / months), [selected, months]);
  const feasible = Math.min(100, Math.round((3900000 / monthly) * 100));

  return (
    <div className="grid gap-5 xl:grid-cols-[.9fr_1.4fr]">
      <div>
        <SectionHeading title="Mục tiêu của bạn" action={<Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Tạo mục tiêu</Button>} />
        <div className="space-y-3">{GOALS.map((goal) => { const percent = Math.round((goal.saved / goal.target) * 100); return <button key={goal.id} onClick={() => { setSelected(goal); setMonths(goal.months); }} className="w-full text-left"><Card className={selected.id === goal.id ? "ring-2 ring-[var(--accent)]" : ""}><div className="flex justify-between gap-4"><div><div className="text-[12.5px] font-semibold">{goal.name}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{goal.type} · hạn {goal.date}</div></div><span className="text-[18px] font-bold text-[var(--accent)]">{percent}%</span></div><div className="mt-4"><ProgressBar value={percent} /></div><div className="mt-2 flex justify-between text-[10.5px] text-[var(--muted)]"><span>{formatMoneyShort(goal.saved)} đã có</span><span>{formatMoneyShort(goal.target)}</span></div></Card></button>; })}</div>
      </div>
      <Card>
        <SectionHeading title={`Mô phỏng · ${selected.name}`} description="Điều chỉnh thời gian để xem mức tiết kiệm cần thiết" />
        <div className="mt-5 grid gap-4 sm:grid-cols-3">{[["Mục tiêu", formatMoney(selected.target)], ["Đã có", formatMoney(selected.saved)], ["Còn thiếu", formatMoney(selected.target - selected.saved)]].map((item) => <div key={item[0]} className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-[10.5px] text-[var(--faint)]">{item[0]}</div><div className="mt-1 text-[14px] font-bold tabular-nums">{item[1]}</div></div>)}</div>
        <div className="mt-6"><div className="flex justify-between text-[12px]"><span>Thời gian tích lũy</span><b>{months} tháng</b></div><Slider min={2} max={24} value={months} onChange={setMonths} /></div>
        <div className="mt-4 rounded-2xl bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))] p-5 text-center"><div className="text-[11px] text-[var(--muted)]">Cần tiết kiệm mỗi tháng</div><div className="mt-2 text-[28px] font-bold text-[var(--accent)] tabular-nums">{formatMoney(monthly)}</div><div className="mt-2 text-[11px]" style={{ color: feasible >= 100 ? "var(--income)" : "var(--warn)" }}>Điểm khả thi {feasible}/100 · {feasible >= 100 ? "An toàn" : "Cần điều chỉnh"}</div></div>
        <div className="mt-6 border-t border-[var(--border)] pt-5"><SectionHeading title="So sánh kịch bản" description="Trả hết vs trả góp" /><Segmented block value={scenario} onChange={(value) => setScenario(String(value))} options={[{ label: "Trả hết một lần", value: "full" }, { label: "Trả góp 12 tháng", value: "installment" }]} /><div className="mt-4 grid gap-3 sm:grid-cols-3">{scenario === "full" ? [["Mỗi tháng", formatMoney(selected.target / 6)], ["Tổng chi phí", formatMoney(selected.target)], ["Khả thi", "62/100"]] : [["Mỗi tháng", formatMoney(selected.target * 1.099 / 12)], ["Tổng chi phí", formatMoney(selected.target * 1.099)], ["Khả thi", "88/100"]].map((item) => <div key={item[0]} className="rounded-xl border border-[var(--border)] p-3"><div className="text-[10px] text-[var(--faint)]">{item[0]}</div><div className="mt-1 text-[13px] font-bold">{item[1]}</div></div>)}</div></div>
      </Card>
      <Modal title="Tạo mục tiêu tài chính" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={() => setOpen(false)}><Form.Item label="Tên mục tiêu"><Input placeholder="VD: Mua xe máy" /></Form.Item><Form.Item label="Số tiền mục tiêu"><Input suffix="₫" placeholder="45.000.000" /></Form.Item><Form.Item label="Đã có"><Input suffix="₫" placeholder="18.000.000" /></Form.Item><Button variant="primary" className="w-full">Tạo mục tiêu</Button></Form></Modal>
    </div>
  );
}
