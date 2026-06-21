import { useState } from "react";
import { Button as AntButton, Form, Input, Modal, Switch } from "antd";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { EMAIL_RULES } from "@/config/mockData";

export function EmailPage() {
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const sync = () => { setSyncing(true); window.setTimeout(() => setSyncing(false), 1200); };

  return (
    <div className="space-y-5">
      <Card accent><div className="flex flex-wrap items-center gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[var(--accent)] text-white"><Icon name="email" width={23} height={23} /></span><div className="min-w-0 flex-1"><div className="text-[13.5px] font-bold">thuan.nguyen@gmail.com</div><div className="mt-1 text-[11px] text-[var(--muted)]">Gmail · OAuth chỉ đọc · Đồng bộ 5 phút trước</div></div><Button onClick={sync} disabled={syncing} icon={<Icon name="sync" width={15} className={syncing ? "animate-spin" : ""} />}>{syncing ? "Đang đồng bộ..." : "Đồng bộ ngay"}</Button></div></Card>
      <SectionHeading title="Rule lắng nghe" description="Chỉ email khớp rule mới được xử lý — bạn toàn quyền kiểm soát" action={<Button icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Thêm rule</Button>} />
      <Card padding="p-0" className="overflow-hidden"><div className="divide-y divide-[var(--border)]">{EMAIL_RULES.map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--surface-3)] text-[10.5px] font-bold">{rule.bank}</span><div className="min-w-[180px] flex-1"><div className="text-[12px] font-semibold">{rule.name}</div><div className="mt-0.5 truncate text-[10.5px] text-[var(--faint)]">{rule.sender}</div></div><div className="text-[10.5px] text-[var(--muted)]">Khớp {rule.matched}</div><Switch defaultChecked={rule.active} /></div>)}</div></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><SectionHeading title="Lịch sử đồng bộ" description="4 lần gần nhất" />{[["Hôm nay · 08:15", "12 email", "8 giao dịch"], ["Hôm qua · 20:00", "18 email", "12 giao dịch"], ["14/06 · 09:30", "23 email", "16 giao dịch"], ["13/06 · 20:00", "7 email", "6 giao dịch"]].map((row) => <div key={row[0]} className="grid grid-cols-3 border-b border-[var(--border)] py-3 text-[11px] last:border-0"><span>{row[0]}</span><span className="text-[var(--muted)]">{row[1]}</span><b className="text-right text-[var(--income)]">{row[2]}</b></div>)}</Card>
        <Card><SectionHeading title="Email cần xem lại" description="Parser chưa đủ độ tin cậy" />{[["ACB · định dạng số tiền lạ", "78%"], ["VCB · thiếu số dư sau giao dịch", "66%"], ["TCB · merchant chưa rõ", "58%"]].map((row) => <div key={row[0]} className="flex items-center justify-between border-b border-[var(--border)] py-3 text-[11.5px] last:border-0"><span>{row[0]}</span><AntButton size="small">{row[1]} · Xem</AntButton></div>)}</Card>
      </div>
      <Modal title="Thêm rule lắng nghe" open={open} onCancel={() => setOpen(false)} footer={null}><Form layout="vertical" onFinish={() => setOpen(false)}><Form.Item label="Tên rule"><Input placeholder="VCB · Biến động số dư" /></Form.Item><Form.Item label="Địa chỉ người gửi"><Input placeholder="no-reply@bank.com.vn" /></Form.Item><Form.Item label="Mã ngân hàng"><Input placeholder="VCB" /></Form.Item><Button variant="primary" className="w-full">Lưu rule</Button></Form></Modal>
    </div>
  );
}
