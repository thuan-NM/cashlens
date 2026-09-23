import { useState } from "react";
import { Form, Input, Modal, Select } from "antd";
import { useCreate, useList } from "@refinedev/core";
import { SparkLine } from "@/components/charts/SparkLine";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatMoney } from "@/utils/format";

const colors = ["#1f6f4a", "#d2604c", "#5b8def", "#b06fd6", "#6d8b3f"];
const typeLabels: Record<string, string> = { BANK_ACCOUNT: "Tài khoản ngân hàng", CHECKING: "Thanh toán", SAVINGS: "Tiết kiệm", CREDIT_CARD: "Thẻ tín dụng", CASH: "Tiền mặt" };

const EmptyBlock = ({ text }: { text: string }) => <Card><div className="py-8 text-center text-[12px] text-[var(--muted)]">{text}</div></Card>;

export function AccountsPage() {
  const [open, setOpen] = useState(false);
  const { result: data, query: { refetch } } = useList<any>({ resource: "financial-accounts", pagination: { mode: "off" } });
  const { result: banks } = useList<any>({ resource: "bank-providers", pagination: { mode: "off" } });
  const { mutateAsync: createAccount } = useCreate();
  const accounts = (data?.data ?? []).map((item: any, index: number) => ({ id: item.id, bank: item.institutionName ?? item.name, code: item.institutionName?.slice(0, 3).toUpperCase() ?? "ACC", type: typeLabels[item.type] ?? item.type, number: item.accountMask ? `•••• ${item.accountMask}` : "-", balance: Number(item.currentBalance ?? item.openingBalance ?? 0), color: colors[index % colors.length], series: [0, 0, 0, 0, Number(item.currentBalance ?? item.openingBalance ?? 0) / 1_000_000] }));
  const available = accounts.filter((item) => item.balance > 0).reduce((sum, item) => sum + item.balance, 0);
  const savings = accounts.filter((item) => item.type.toLowerCase().includes("tiết") || item.type.toLowerCase().includes("saving")).reduce((sum, item) => sum + item.balance, 0);
  const debt = accounts.filter((item) => item.balance < 0).reduce((sum, item) => sum + item.balance, 0);

  const submit = async (values: any) => {
    await createAccount({ resource: "financial-accounts", values: { name: values.name, institutionName: values.institutionName, type: values.type, accountMask: values.accountMask, currentBalance: Number(values.currentBalance ?? 0) } });
    setOpen(false);
    refetch();
  };

  return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-3">{[["Tổng tiền khả dụng", available, "var(--income)", "Không gồm thẻ tín dụng"], ["Đang tiết kiệm", savings, "var(--accent)", "Số dư tiết kiệm"], ["Dư nợ thẻ", debt, "var(--expense)", "Cần thanh toán"]].map((item) => <Card key={item[0]}><div className="text-[11.5px] text-[var(--muted)]">{item[0]}</div><div className="mt-2 text-[21px] font-bold tabular-nums" style={{ color: String(item[2]) }}>{formatMoney(item[1] as number)}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{item[3]}</div></Card>)}</div><SectionHeading title="Tài khoản đã liên kết" description={`${accounts.length} tài khoản`} action={<Button onClick={() => setOpen(true)} icon={<Icon name="plus" width={15} />}>Thêm tài khoản</Button>} />{accounts.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <Card key={account.id} hover><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[11px] text-[11px] font-bold" style={{ color: account.color, background: `${account.color}22` }}>{account.code}</span><div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold">{account.bank}</div><div className="text-[10.5px] text-[var(--faint)]">{account.type}</div></div></div><div className="mt-5 flex items-end justify-between gap-3"><div><div className="text-[20px] font-bold tabular-nums" style={{ color: account.balance < 0 ? "var(--expense)" : "var(--text)" }}>{formatMoney(account.balance)}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{account.number}</div></div><SparkLine data={account.series} color={account.color} width={90} height={34} /></div></Card>)}</div> : <EmptyBlock text="Chưa có tài khoản tài chính từ API." />}<Modal title="Thêm tài khoản" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={submit}><Form.Item label="Tên tài khoản" name="name"><Input placeholder="VCB thanh toán" /></Form.Item><Form.Item label="Ngân hàng" name="institutionName"><Select options={(banks?.data ?? []).map((item: any) => ({ label: item.name, value: item.name }))} /></Form.Item><Form.Item label="Loại tài khoản" name="type" initialValue="BANK_ACCOUNT"><Select options={["BANK_ACCOUNT", "CHECKING", "SAVINGS", "CREDIT_CARD", "CASH"].map((item) => ({ label: typeLabels[item] ?? item, value: item }))} /></Form.Item><Form.Item label="4 số cuối" name="accountMask"><Input placeholder="4521" /></Form.Item><Form.Item label="Số dư" name="currentBalance"><Input placeholder="0" /></Form.Item><Button variant="primary" className="w-full">Thêm tài khoản</Button></Form></Modal></div>;
}
