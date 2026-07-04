import { useMemo, useState } from "react";
import { Drawer, Form, Input, Modal, Select, Segmented } from "antd";
import { useCreate, useDelete, useList, useUpdate } from "@refinedev/core";
import type { Transaction } from "@/types/transaction";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { mapCategory, mapTransaction } from "@/api/mappers";
import { formatMoney, formatSign } from "@/utils/format";

const directionMap: Record<string, string | undefined> = {
  all: undefined,
  income: "INCOME",
  expense: "EXPENSE",
  transfer: "TRANSFER_OUT",
};

const EmptyBlock = ({ text }: { text: string }) => (
  <div className="p-8 text-center text-[12px] text-[var(--muted)]">{text}</div>
);

export function TransactionsPage() {
  const [direction, setDirection] = useState("all");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { result: categoryResult } = useList<any>({ resource: "transaction-categories", pagination: { mode: "off" } });
  const categories = categoryResult?.data?.map(mapCategory) ?? [];
  const filters = [
    directionMap[direction] ? { field: "direction", operator: "eq" as const, value: directionMap[direction] } : null,
    category !== "all" ? { field: "categoryId", operator: "eq" as const, value: category } : null,
  ].filter(Boolean) as any[];
  const { result: data, query: { refetch } } = useList<any>({ resource: "transactions", filters, pagination: { currentPage: 1, pageSize: 50 } });
  const { mutateAsync: createTransaction } = useCreate();
  const { mutateAsync: updateTransaction } = useUpdate();
  const { mutateAsync: deleteTransaction } = useDelete();
  const transactions = useMemo(() => data?.data?.map(mapTransaction) ?? [], [data?.data]);

  const submitManual = async (values: any) => {
    await createTransaction({
      resource: "transactions",
      values: {
        amount: Number(values.amount ?? 0),
        currency: "VND",
        direction: values.direction ?? "EXPENSE",
        transactionTime: new Date().toISOString(),
        description: values.description,
        categoryId: values.categoryId,
      },
    });
    setModalOpen(false);
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[["Tổng thu", transactions.filter((item) => item.dir === "income").reduce((sum, item) => sum + item.amount, 0), "var(--income)"], ["Tổng chi", transactions.filter((item) => item.dir === "expense").reduce((sum, item) => sum + item.amount, 0), "var(--expense)"], ["Dòng tiền ròng", transactions.reduce((sum, item) => sum + (item.dir === "income" ? item.amount : item.dir === "expense" ? -item.amount : 0), 0), "var(--accent)"]].map((item) => <Card key={item[0]}><div className="text-[11.5px] text-[var(--muted)]">{item[0]}</div><div className="mt-2 text-[22px] font-bold tabular-nums" style={{ color: String(item[2]) }}>{formatMoney(item[1] as number)}</div></Card>)}
      </div>
      <Card padding="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={direction} onChange={(value) => setDirection(String(value))} options={[{ label: "Tất cả", value: "all" }, { label: "Thu", value: "income" }, { label: "Chi", value: "expense" }, { label: "Chuyển khoản", value: "transfer" }]} />
          <Select className="min-w-[180px]" value={category} onChange={setCategory} options={[{ label: "Tất cả nhóm", value: "all" }, ...categories.map((item) => ({ label: item.name, value: item.id }))]} />
          <div className="ml-auto flex gap-2"><Button>Quy tắc phân loại</Button><Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setModalOpen(true)}>Thêm giao dịch</Button></div>
        </div>
      </Card>
      <Card padding="p-0" className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_150px_90px_130px] gap-3 border-b border-[var(--border)] px-5 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid"><span>Giao dịch</span><span>Nhóm</span><span>Ngân hàng</span><span className="text-right">Số tiền</span></div>
        {transactions.length ? <div className="divide-y divide-[var(--border)]">{transactions.map((transaction) => { const cat = categories.find((item) => item.id === transaction.cat); return <button key={transaction.id} onClick={() => setSelected(transaction)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)] md:grid-cols-[1fr_150px_90px_130px] md:px-5"><div className="flex min-w-0 items-center gap-3"><span className="h-9 w-9 shrink-0 rounded-[10px]" style={{ background: `${cat?.color ?? "#8a8378"}22` }} /><div className="min-w-0"><div className="truncate text-[12px] font-semibold">{transaction.desc}</div><div className="text-[10.5px] text-[var(--faint)]">{transaction.time} · {transaction.merchant}</div></div></div><span className="hidden items-center gap-2 text-[11.5px] md:flex"><span className="h-2 w-2 rounded-full" style={{ background: cat?.color ?? "#8a8378" }} />{cat?.name ?? "Chưa phân loại"}</span><span className="hidden text-[11.5px] text-[var(--muted)] md:block">{transaction.bank}</span><span className="text-right text-[12px] font-bold tabular-nums" style={{ color: transaction.dir === "income" ? "var(--income)" : "var(--text)" }}>{formatSign(transaction.amount, transaction.dir)}</span></button>; })}</div> : <EmptyBlock text="Chưa có giao dịch từ API. Hãy thêm giao dịch thủ công hoặc đồng bộ email." />}
      </Card>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Chi tiết giao dịch" width={420} extra={selected ? <Button onClick={async () => { await deleteTransaction({ resource: "transactions", id: selected.id }); setSelected(null); refetch(); }}>Xóa</Button> : null}>
        {selected && <div className="space-y-5"><div className="rounded-2xl bg-[var(--surface-2)] p-5 text-center"><div className="text-[12px] text-[var(--muted)]">{selected.desc}</div><div className="mt-2 text-[28px] font-bold tabular-nums">{formatSign(selected.amount, selected.dir)}</div></div><Input.TextArea placeholder="Ghi chú cho giao dịch..." rows={4} onBlur={(event) => updateTransaction({ resource: "transactions", id: selected.id, values: { userNote: event.target.value } })} /></div>}
      </Drawer>
      <Modal title="Thêm giao dịch thủ công" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form layout="vertical" onFinish={submitManual}><Form.Item label="Loại" name="direction" initialValue="EXPENSE"><Segmented block options={[{ label: "Chi", value: "EXPENSE" }, { label: "Thu", value: "INCOME" }, { label: "Chuyển khoản", value: "TRANSFER_OUT" }]} /></Form.Item><Form.Item label="Số tiền" name="amount"><Input suffix="VND" placeholder="0" /></Form.Item><Form.Item label="Mô tả" name="description"><Input placeholder="VD: Cơm trưa văn phòng" /></Form.Item><Form.Item label="Nhóm" name="categoryId"><Select options={categories.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item><Button variant="primary" className="w-full">Thêm giao dịch</Button></Form>
      </Modal>
    </div>
  );
}
