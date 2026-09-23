import { useState } from "react";
import { Button as AntButton, Form, Input, Modal, Switch } from "antd";
import { useCreate, useCustom, useCustomMutation, useList } from "@refinedev/core";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";

const toArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }

  return [];
};

export function EmailPage() {
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const { result: connectionsResult } = useList<any>({ resource: "email-connections", pagination: { mode: "off" } });
  const { result: rulesResult, query: { refetch: refetchRules } } = useList<any>({ resource: "email-listen-rules", pagination: { mode: "off" } });
  const connections = toArray<any>(connectionsResult?.data);
  const rules = toArray<any>(rulesResult?.data);
  const firstConnection = connections[0];
  const { result: runsResult } = useCustom<any[]>({ url: firstConnection ? `/email-connections/${firstConnection.id}/sync-runs` : "/email-connections/none/sync-runs", method: "get", queryOptions: { enabled: Boolean(firstConnection) } });
  const runs = toArray<any>(runsResult?.data);
  const { mutateAsync } = useCustomMutation();
  const { mutateAsync: createRule } = useCreate();

  const connect = async () => {
    const response = await mutateAsync({ url: "/email-connections/gmail/connect", method: "post", values: {} });
    const authUrl = (response as any)?.data?.authUrl;
    if (authUrl) window.location.href = authUrl;
  };

  const sync = async () => {
    if (!firstConnection) return;
    setSyncing(true);
    try {
      await mutateAsync({ url: `/email-connections/${firstConnection.id}/sync`, method: "post", values: {} });
    } finally {
      setSyncing(false);
    }
  };

  const submitRule = async (values: any) => {
    await createRule({ resource: "email-listen-rules", values: { name: values.name, senderEmail: values.senderEmail, senderDomain: values.senderDomain, isEnabled: true } });
    setOpen(false);
    refetchRules();
  };

  return (
    <div className="space-y-5">
      <Card accent>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[var(--accent)] text-white"><Icon name="email" width={23} height={23} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-bold">{firstConnection?.emailAddress ?? "Chưa kết nối Gmail"}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">{firstConnection ? `${firstConnection.provider} · ${firstConnection.status}` : "OAuth chỉ đọc"}</div>
          </div>
          {firstConnection ? <Button onClick={sync} disabled={syncing} icon={<Icon name="sync" width={15} className={syncing ? "animate-spin" : ""} />}>{syncing ? "Đang đồng bộ..." : "Đồng bộ ngay"}</Button> : <Button onClick={connect} icon={<Icon name="plus" width={15} />}>Kết nối Gmail</Button>}
        </div>
      </Card>

      <SectionHeading title="Rule lắng nghe" description="Chỉ email khớp rule mới được xử lý" action={<Button icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Thêm rule</Button>} />
      <Card padding="p-0" className="overflow-hidden">
        {rules.length ? <div className="divide-y divide-[var(--border)]">{rules.map((rule: any) => <div key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--surface-3)] text-[10.5px] font-bold">{rule.bank ?? "API"}</span><div className="min-w-[180px] flex-1"><div className="text-[12px] font-semibold">{rule.name}</div><div className="mt-0.5 truncate text-[10.5px] text-[var(--faint)]">{rule.senderEmail ?? rule.senderDomain ?? "Chưa cấu hình sender"}</div></div><div className="text-[10.5px] text-[var(--muted)]">{rule.lastMatchedAt ? new Date(rule.lastMatchedAt).toLocaleString("vi-VN") : "Chưa khớp"}</div><Switch defaultChecked={rule.isEnabled ?? false} /></div>)}</div> : <div className="p-8 text-center text-[12px] text-[var(--muted)]">Chưa có rule lắng nghe từ API.</div>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Lịch sử đồng bộ" description="Lần gần nhất" />
          {runs.length ? runs.slice(0, 4).map((row: any) => <div key={row.id} className="grid grid-cols-3 border-b border-[var(--border)] py-3 text-[11px] last:border-0"><span>{new Date(row.startedAt).toLocaleString("vi-VN")}</span><span className="text-[var(--muted)]">{row.emailsFound} email</span><b className="text-right text-[var(--income)]">{row.transactionsCreated} giao dịch</b></div>) : <div className="py-6 text-center text-[12px] text-[var(--muted)]">Chưa có lượt đồng bộ.</div>}
        </Card>
        <Card><SectionHeading title="Email cần xem lại" description="Parser chưa đủ độ tin cậy" /><AntButton size="small">Mở danh sách email</AntButton></Card>
      </div>

      <Modal title="Thêm rule lắng nghe" open={open} onCancel={() => setOpen(false)} footer={null}>
        <Form layout="vertical" onFinish={submitRule}>
          <Form.Item label="Tên rule" name="name"><Input placeholder="VCB · Biến động số dư" /></Form.Item>
          <Form.Item label="Địa chỉ người gửi" name="senderEmail"><Input placeholder="no-reply@bank.com.vn" /></Form.Item>
          <Form.Item label="Domain người gửi" name="senderDomain"><Input placeholder="bank.com.vn" /></Form.Item>
          <Button variant="primary" className="w-full">Lưu rule</Button>
        </Form>
      </Modal>
    </div>
  );
}
