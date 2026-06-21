import { useState } from "react";
import { Form, Input, Modal, Select } from "antd";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUDGETS, CATEGORIES, getCat } from "@/config/mockData";
import { formatMoney, formatMoneyShort } from "@/utils/format";

export function BudgetsPage() {
  const [open, setOpen] = useState(false);
  const totalLimit = BUDGETS.reduce((sum, item) => sum + item.limit, 0);
  const totalSpent = BUDGETS.reduce((sum, item) => sum + item.spent, 0);

  return (
    <div className="space-y-5">
      <Card accent><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11.5px] text-[var(--muted)]">Tổng ngân sách tháng 6</div><div className="mt-2 text-[30px] font-bold tabular-nums">{formatMoney(totalLimit)}</div><div className="mt-1 text-[11px] text-[var(--muted)]">Đã dùng {formatMoney(totalSpent)} · còn {formatMoney(totalLimit - totalSpent)}</div></div><div className="min-w-[220px] flex-1 sm:max-w-[420px]"><div className="mb-2 flex justify-between text-[11px]"><span>Tiến độ chung</span><b>{Math.round((totalSpent / totalLimit) * 100)}%</b></div><ProgressBar value={(totalSpent / totalLimit) * 100} /></div></div></Card>
      <SectionHeading title="Ngân sách theo nhóm" action={<Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Tạo ngân sách</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {BUDGETS.map((budget) => { const cat = getCat(budget.cat); const percent = Math.round((budget.spent / budget.limit) * 100); const over = percent > 100; const color = over ? "var(--expense)" : percent >= budget.threshold ? "var(--warn)" : cat.color; return <Card key={budget.cat} hover><div className="flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="h-9 w-9 rounded-[10px]" style={{ background: `${cat.color}22` }} /><div><div className="text-[12.5px] font-semibold">{cat.name}</div><div className="text-[10.5px] text-[var(--faint)]">Ngưỡng cảnh báo {budget.threshold}%</div></div></div><span className="text-[17px] font-bold" style={{ color }}>{percent}%</span></div><div className="mt-5"><ProgressBar value={percent} color={color} /></div><div className="mt-2 flex justify-between text-[11px]"><span className="text-[var(--muted)]">Đã chi <b className="text-[var(--text)]">{formatMoneyShort(budget.spent)}</b></span><span>Còn {formatMoneyShort(Math.max(0, budget.limit - budget.spent))}</span></div></Card>; })}
      </div>
      <Modal title="Tạo ngân sách mới" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={() => setOpen(false)}><Form.Item label="Nhóm chi tiêu"><Select options={CATEGORIES.filter((item) => item.type === "expense").map((item) => ({ label: item.name, value: item.id }))} /></Form.Item><Form.Item label="Hạn mức"><Input suffix="₫" placeholder="3.000.000" /></Form.Item><Form.Item label="Ngưỡng cảnh báo"><Input suffix="%" defaultValue="80" /></Form.Item><Button variant="primary" className="w-full">Tạo ngân sách</Button></Form></Modal>
    </div>
  );
}
