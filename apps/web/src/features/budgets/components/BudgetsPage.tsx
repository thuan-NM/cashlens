import { useState } from "react";
import { Form, Input, Modal, Select } from "antd";
import { useCreate, useCustom, useList } from "@refinedev/core";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { mapBudget, mapCategory } from "@/api/mappers";
import { formatMoney, formatMoneyShort } from "@/utils/format";

export function BudgetsPage() {
  const [open, setOpen] = useState(false);
  const { result: data, query: { refetch } } = useList<any>({ resource: "budgets", pagination: { mode: "off" } });
  const { result: summary } = useCustom<any>({ url: "/budgets/summary", method: "get" });
  const { result: categoriesResult } = useList<any>({ resource: "transaction-categories", pagination: { mode: "off" } });
  const { mutateAsync: createBudget } = useCreate();
  const categories = categoriesResult?.data?.map(mapCategory) ?? [];
  const budgets = data?.data?.map(mapBudget) ?? [];
  const totalLimit = Number(summary?.data?.totalLimit ?? budgets.reduce((sum, item) => sum + item.limit, 0));
  const totalSpent = Number(summary?.data?.totalSpent ?? budgets.reduce((sum, item) => sum + item.spent, 0));

  const submit = async (values: any) => {
    await createBudget({ resource: "budgets", values: { name: values.name, categoryId: values.categoryId, amount: Number(values.amount ?? 0), startsAt: new Date().toISOString(), thresholdPercent: Number(values.thresholdPercent ?? 80) } });
    setOpen(false);
    refetch();
  };

  return <div className="space-y-5"><Card accent><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11.5px] text-[var(--muted)]">Tổng ngân sách tháng</div><div className="mt-2 text-[30px] font-bold tabular-nums">{formatMoney(totalLimit)}</div><div className="mt-1 text-[11px] text-[var(--muted)]">Đã dùng {formatMoney(totalSpent)} · còn {formatMoney(totalLimit - totalSpent)}</div></div><div className="min-w-[220px] flex-1 sm:max-w-[420px]"><div className="mb-2 flex justify-between text-[11px]"><span>Tiến độ chung</span><b>{totalLimit ? Math.round((totalSpent / totalLimit) * 100) : 0}%</b></div><ProgressBar value={totalLimit ? (totalSpent / totalLimit) * 100 : 0} /></div></div></Card><SectionHeading title="Ngân sách theo nhóm" action={<Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Tạo ngân sách</Button>} />{budgets.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{budgets.map((budget) => { const cat = categories.find((item) => item.id === budget.cat) ?? { name: "Chưa phân loại", color: "#8a8378", type: "expense" }; const percent = budget.limit ? Math.round((budget.spent / budget.limit) * 100) : 0; const color = percent > 100 ? "var(--expense)" : percent >= budget.threshold ? "var(--warn)" : cat.color; return <Card key={budget.cat} hover><div className="flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="h-9 w-9 rounded-[10px]" style={{ background: `${cat.color}22` }} /><div><div className="text-[12.5px] font-semibold">{cat.name}</div><div className="text-[10.5px] text-[var(--faint)]">Ngưỡng cảnh báo {budget.threshold}%</div></div></div><span className="text-[17px] font-bold" style={{ color }}>{percent}%</span></div><div className="mt-5"><ProgressBar value={percent} color={color} /></div><div className="mt-2 flex justify-between text-[11px]"><span className="text-[var(--muted)]">Đã chi <b className="text-[var(--text)]">{formatMoneyShort(budget.spent)}</b></span><span>Còn {formatMoneyShort(Math.max(0, budget.limit - budget.spent))}</span></div></Card>; })}</div> : <Card><div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có ngân sách từ API.</div></Card>}<Modal title="Tạo ngân sách mới" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={submit}><Form.Item label="Tên ngân sách" name="name"><Input placeholder="Ăn uống tháng này" /></Form.Item><Form.Item label="Nhóm chi tiêu" name="categoryId"><Select options={categories.filter((item) => item.type === "expense").map((item) => ({ label: item.name, value: item.id }))} /></Form.Item><Form.Item label="Hạn mức" name="amount"><Input suffix="VND" placeholder="3000000" /></Form.Item><Form.Item label="Ngưỡng cảnh báo" name="thresholdPercent" initialValue="80"><Input suffix="%" /></Form.Item><Button variant="primary" className="w-full">Tạo ngân sách</Button></Form></Modal></div>;
}
