import { useMemo, useState } from "react";
import { Form, Input, Modal, Segmented, Slider } from "antd";
import { useCreate, useCustom, useList } from "@refinedev/core";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { mapGoal } from "@/api/mappers";
import { formatMoney, formatMoneyShort } from "@/utils/format";

export function GoalsPage() {
  const { result: data, query: { refetch } } = useList<any>({ resource: "goals", pagination: { mode: "off" } });
  const { mutateAsync: createGoal } = useCreate();
  const goals = data?.data?.map(mapGoal) ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = goals.find((goal) => goal.id === (selectedId ?? goals[0]?.id)) ?? goals[0];
  const [months, setMonths] = useState(selected?.months ?? 6);
  const [scenario, setScenario] = useState("FULL");
  const [open, setOpen] = useState(false);
  const { result: simulation } = useCustom<any>({ url: selected ? `/goals/${selected.id}/simulation` : "/goals/none/simulation", method: "get", config: { query: { months, scenario } }, queryOptions: { enabled: Boolean(selected) } });
  const monthly = useMemo(() => simulation?.data?.monthlyRequired ?? Math.max(0, ((selected?.target ?? 0) - (selected?.saved ?? 0)) / months), [selected, months, simulation?.data]);
  const feasible = simulation?.data?.feasibilityScore ?? Math.min(100, Math.round((3900000 / Math.max(1, monthly)) * 100));

  const submit = async (values: any) => {
    await createGoal({ resource: "goals", values: { name: values.name, targetAmount: Number(values.targetAmount ?? 0), savedAmount: Number(values.savedAmount ?? 0), months: Number(values.months ?? 6), type: values.type } });
    setOpen(false);
    refetch();
  };

  if (!selected) return <div className="space-y-5"><SectionHeading title="Mục tiêu của bạn" action={<Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Tạo mục tiêu</Button>} /><Card><div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có mục tiêu tài chính từ API.</div></Card><Modal title="Tạo mục tiêu tài chính" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={submit}><Form.Item label="Tên mục tiêu" name="name"><Input placeholder="VD: Mua xe máy" /></Form.Item><Form.Item label="Loại" name="type"><Input placeholder="Mua sắm dự định" /></Form.Item><Form.Item label="Số tiền mục tiêu" name="targetAmount"><Input suffix="VND" /></Form.Item><Form.Item label="Đã có" name="savedAmount"><Input suffix="VND" /></Form.Item><Form.Item label="Số tháng" name="months"><Input /></Form.Item><Button variant="primary" className="w-full">Tạo mục tiêu</Button></Form></Modal></div>;

  return <div className="grid gap-5 xl:grid-cols-[.9fr_1.4fr]"><div><SectionHeading title="Mục tiêu của bạn" action={<Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Tạo mục tiêu</Button>} /><div className="space-y-3">{goals.map((goal) => { const percent = Math.round((goal.saved / Math.max(1, goal.target)) * 100); return <button key={goal.id} onClick={() => { setSelectedId(goal.id); setMonths(goal.months); }} className="w-full text-left"><Card className={selected.id === goal.id ? "ring-2 ring-[var(--accent)]" : ""}><div className="flex justify-between gap-4"><div><div className="text-[12.5px] font-semibold">{goal.name}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{goal.type} · hạn {goal.date}</div></div><span className="text-[18px] font-bold text-[var(--accent)]">{percent}%</span></div><div className="mt-4"><ProgressBar value={percent} /></div><div className="mt-2 flex justify-between text-[10.5px] text-[var(--muted)]"><span>{formatMoneyShort(goal.saved)} đã có</span><span>{formatMoneyShort(goal.target)}</span></div></Card></button>; })}</div></div><Card><SectionHeading title={`Mô phỏng · ${selected.name}`} description="Điều chỉnh thời gian để xem mức tiết kiệm cần thiết" /><div className="mt-5 grid gap-4 sm:grid-cols-3">{[["Mục tiêu", formatMoney(selected.target)], ["Đã có", formatMoney(selected.saved)], ["Còn thiếu", formatMoney(selected.target - selected.saved)]].map((item) => <div key={item[0]} className="rounded-xl bg-[var(--surface-2)] p-3"><div className="text-[10.5px] text-[var(--faint)]">{item[0]}</div><div className="mt-1 text-[14px] font-bold tabular-nums">{item[1]}</div></div>)}</div><div className="mt-6"><div className="flex justify-between text-[12px]"><span>Thời gian tích lũy</span><b>{months} tháng</b></div><Slider min={2} max={24} value={months} onChange={setMonths} /></div><div className="mt-4 rounded-2xl bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))] p-5 text-center"><div className="text-[11px] text-[var(--muted)]">Cần tiết kiệm mỗi tháng</div><div className="mt-2 text-[28px] font-bold text-[var(--accent)] tabular-nums">{formatMoney(monthly)}</div><div className="mt-2 text-[11px]" style={{ color: feasible >= 100 ? "var(--income)" : "var(--warn)" }}>Điểm khả thi {feasible}/100</div></div><div className="mt-6 border-t border-[var(--border)] pt-5"><SectionHeading title="So sánh kịch bản" /><Segmented block value={scenario} onChange={(value) => setScenario(String(value))} options={[{ label: "Trả hết một lần", value: "FULL" }, { label: "Trả góp 12 tháng", value: "INSTALLMENT" }]} /></div></Card><Modal title="Tạo mục tiêu tài chính" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={submit}><Form.Item label="Tên mục tiêu" name="name"><Input placeholder="VD: Mua xe máy" /></Form.Item><Form.Item label="Loại" name="type"><Input placeholder="Mua sắm dự định" /></Form.Item><Form.Item label="Số tiền mục tiêu" name="targetAmount"><Input suffix="VND" /></Form.Item><Form.Item label="Đã có" name="savedAmount"><Input suffix="VND" /></Form.Item><Form.Item label="Số tháng" name="months"><Input /></Form.Item><Button variant="primary" className="w-full">Tạo mục tiêu</Button></Form></Modal></div>;
}
