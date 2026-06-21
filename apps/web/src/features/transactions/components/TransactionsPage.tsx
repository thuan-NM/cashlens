import { useMemo, useState } from "react";
import { Drawer, Form, Input, Modal, Select, Segmented } from "antd";
import type { Transaction } from "@/types/transaction";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { CATEGORIES, TRANSACTIONS, getCat } from "@/config/mockData";
import { formatMoney, formatSign } from "@/utils/format";

export function TransactionsPage() {
  const [direction, setDirection] = useState("all");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const filtered = useMemo(
    () => TRANSACTIONS.filter((item) => (direction === "all" || item.dir === direction) && (category === "all" || item.cat === category)),
    [direction, category]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[["Tổng thu", 28000000, "var(--income)"], ["Tổng chi", 20800000, "var(--expense)"], ["Dòng tiền ròng", 7200000, "var(--accent)"]].map((item) => (
          <Card key={item[0]}><div className="text-[11.5px] text-[var(--muted)]">{item[0]}</div><div className="mt-2 text-[22px] font-bold tabular-nums" style={{ color: String(item[2]) }}>{item[0] === "Dòng tiền ròng" ? "+" : ""}{formatMoney(item[1] as number)}</div></Card>
        ))}
      </div>
      <Card padding="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={direction} onChange={(value) => setDirection(String(value))} options={[{ label: "Tất cả", value: "all" }, { label: "Thu", value: "income" }, { label: "Chi", value: "expense" }, { label: "Chuyển khoản", value: "transfer" }]} />
          <Select className="min-w-[180px]" value={category} onChange={setCategory} options={[{ label: "Tất cả nhóm", value: "all" }, ...CATEGORIES.map((item) => ({ label: item.name, value: item.id }))]} />
          <div className="ml-auto flex gap-2"><Button>Quy tắc phân loại</Button><Button variant="primary" icon={<Icon name="plus" width={15} />} onClick={() => setModalOpen(true)}>Thêm giao dịch</Button></div>
        </div>
      </Card>
      <Card padding="p-0" className="overflow-hidden">
        <div className="hidden grid-cols-[1fr_150px_90px_130px] gap-3 border-b border-[var(--border)] px-5 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint)] md:grid"><span>Giao dịch</span><span>Nhóm</span><span>Ngân hàng</span><span className="text-right">Số tiền</span></div>
        <div className="divide-y divide-[var(--border)]">
          {filtered.map((transaction) => {
            const cat = getCat(transaction.cat);
            return (
              <button key={transaction.id} onClick={() => setSelected(transaction)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)] md:grid-cols-[1fr_150px_90px_130px] md:px-5">
                <div className="flex min-w-0 items-center gap-3"><span className="h-9 w-9 shrink-0 rounded-[10px]" style={{ background: `${cat.color}22` }} /><div className="min-w-0"><div className="truncate text-[12px] font-semibold">{transaction.desc}</div><div className="text-[10.5px] text-[var(--faint)]">{transaction.time} · {transaction.merchant}</div></div></div>
                <span className="hidden items-center gap-2 text-[11.5px] md:flex"><span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />{cat.name}</span>
                <span className="hidden text-[11.5px] text-[var(--muted)] md:block">{transaction.bank}</span>
                <span className="text-right text-[12px] font-bold tabular-nums" style={{ color: transaction.dir === "income" ? "var(--income)" : "var(--text)" }}>{formatSign(transaction.amount, transaction.dir)}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Chi tiết giao dịch" width={420}>
        {selected && <div className="space-y-5"><div className="rounded-2xl bg-[var(--surface-2)] p-5 text-center"><div className="text-[12px] text-[var(--muted)]">{selected.desc}</div><div className="mt-2 text-[28px] font-bold tabular-nums">{formatSign(selected.amount, selected.dir)}</div></div>{[["Thời gian", selected.time], ["Ngân hàng", selected.bank], ["Nguồn", selected.src === "email" ? "Email tự động" : "Nhập thủ công"], ["Nhóm", getCat(selected.cat).name]].map((row) => <div key={row[0]} className="flex justify-between border-b border-[var(--border)] pb-3 text-[12px]"><span className="text-[var(--muted)]">{row[0]}</span><b>{row[1]}</b></div>)}<Input.TextArea placeholder="Ghi chú cho giao dịch..." rows={4} /></div>}
      </Drawer>
      <Modal title="Thêm giao dịch thủ công" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form layout="vertical" onFinish={() => setModalOpen(false)}><Form.Item label="Loại"><Segmented block options={["Chi", "Thu", "Chuyển khoản"]} /></Form.Item><Form.Item label="Số tiền"><Input suffix="₫" placeholder="0" /></Form.Item><Form.Item label="Mô tả"><Input placeholder="VD: Cơm trưa văn phòng" /></Form.Item><Form.Item label="Nhóm"><Select options={CATEGORIES.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item><Button variant="primary" className="w-full">Thêm giao dịch</Button></Form>
      </Modal>
    </div>
  );
}
