import { useState } from "react";
import { Form, Input, Modal, Select } from "antd";
import { SparkLine } from "@/components/charts/SparkLine";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ACCOUNTS } from "@/config/mockData";
import { formatMoney } from "@/utils/format";

export function AccountsPage() {
  const [open, setOpen] = useState(false);
  const available = ACCOUNTS.filter((item) => item.balance > 0).reduce((sum, item) => sum + item.balance, 0);
  const savings = ACCOUNTS.filter((item) => item.type === "Sổ tiết kiệm").reduce((sum, item) => sum + item.balance, 0);
  const debt = ACCOUNTS.filter((item) => item.balance < 0).reduce((sum, item) => sum + item.balance, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">{[["Tổng tiền khả dụng", available, "var(--income)", "Không gồm thẻ tín dụng"], ["Đang tiết kiệm", savings, "var(--accent)", "Sổ tiết kiệm"], ["Dư nợ thẻ", debt, "var(--expense)", "Cần thanh toán"]].map((item) => <Card key={item[0]}><div className="text-[11.5px] text-[var(--muted)]">{item[0]}</div><div className="mt-2 text-[21px] font-bold tabular-nums" style={{ color: String(item[2]) }}>{formatMoney(item[1] as number)}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{item[3]}</div></Card>)}</div>
      <SectionHeading title="Tài khoản đã liên kết" description="5 tài khoản từ 4 ngân hàng" action={<Button onClick={() => setOpen(true)} icon={<Icon name="plus" width={15} />}>Thêm tài khoản</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ACCOUNTS.map((account) => <Card key={account.id} hover><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[11px] text-[11px] font-bold" style={{ color: account.color, background: `${account.color}22` }}>{account.code}</span><div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold">{account.bank}</div><div className="text-[10.5px] text-[var(--faint)]">{account.type}</div></div><span className="rounded-md px-2 py-1 text-[10.5px] font-semibold" style={{ color: account.delta >= 0 ? "var(--income)" : "var(--expense)", background: account.delta >= 0 ? "rgba(74,157,110,.12)" : "rgba(210,96,76,.12)" }}>{account.delta >= 0 ? "▲" : "▼"} {Math.abs(account.delta)}%</span></div><div className="mt-5 flex items-end justify-between gap-3"><div><div className="text-[20px] font-bold tabular-nums" style={{ color: account.balance < 0 ? "var(--expense)" : "var(--text)" }}>{formatMoney(account.balance)}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{account.number}</div></div><SparkLine data={account.series} color={account.color} width={90} height={34} /></div></Card>)}
      </div>
      <Modal title="Thêm tài khoản" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={() => setOpen(false)}><Form.Item label="Ngân hàng"><Select options={["Vietcombank", "Techcombank", "MB Bank", "ACB", "VietinBank"].map((item) => ({ label: item, value: item }))} /></Form.Item><Form.Item label="Loại tài khoản"><Select options={["Tài khoản thanh toán", "Tài khoản lương", "Sổ tiết kiệm", "Thẻ tín dụng"].map((item) => ({ label: item, value: item }))} /></Form.Item><Form.Item label="4 số cuối"><Input placeholder="4521" /></Form.Item><Button variant="primary" className="w-full">Thêm tài khoản</Button></Form></Modal>
    </div>
  );
}
