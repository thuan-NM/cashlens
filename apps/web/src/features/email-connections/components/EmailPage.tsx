import { useRef, useState } from "react";
import { Alert, Button as AntButton, Form, Input, Modal, Skeleton, Switch } from "antd";
import { useCreate, useCustom, useCustomMutation, useList } from "@refinedev/core";
import { describeApiError } from "@/api/mappers";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { ApiEmailListenRule } from "@/types/email";
import {
  type EmailConnection,
  type SyncOutcome,
  type SyncRun,
  RUN_STATUS,
  TONE_COLORS,
  connectionState,
  outcomeOfError,
  outcomeOfRun,
  runCounts,
} from "../sync-state";

const toArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }

  return [];
};

type ListenRuleFormValues = { name?: string; senderEmail?: string; senderDomain?: string };

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("vi-VN") : "-");

export function EmailPage() {
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  // Guards against a second POST before the disabled state renders.
  const syncInFlight = useRef(false);
  // Same guard for saving a listen rule: a double click must create one rule.
  const ruleInFlight = useRef(false);
  const [savingRule, setSavingRule] = useState(false);
  const [open, setOpen] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const { result: connectionsResult, query: connectionsQuery } = useList<EmailConnection>({ resource: "email-connections", pagination: { mode: "off" } });
  const { result: rulesResult, query: { refetch: refetchRules } } = useList<ApiEmailListenRule>({ resource: "email-listen-rules", pagination: { mode: "off" } });
  const connections = toArray<EmailConnection>(connectionsResult?.data);
  const rules = toArray<ApiEmailListenRule>(rulesResult?.data);
  const firstConnection = connections[0];
  const { result: runsResult, query: runsQuery } = useCustom<SyncRun[]>({
    url: firstConnection ? `/email-connections/${firstConnection.id}/sync-runs` : "/email-connections/none/sync-runs",
    method: "get",
    queryOptions: { enabled: Boolean(firstConnection) },
  });
  const runs = toArray<SyncRun>(runsResult?.data);
  const { mutateAsync } = useCustomMutation();
  const { mutateAsync: createRule } = useCreate();
  const state = firstConnection ? connectionState(firstConnection) : null;

  const connect = async () => {
    setConnecting(true);
    try {
      const response = await mutateAsync({ url: "/email-connections/gmail/connect", method: "post", values: {} });
      const data = (response as { data?: { authorizationUrl?: string } })?.data;
      if (data?.authorizationUrl) window.location.href = data.authorizationUrl;
    } catch (error) {
      setOutcome({ tone: "error", title: "Không thể bắt đầu kết nối Gmail", detail: describeApiError(error) });
    } finally {
      setConnecting(false);
    }
  };

  // One bounded batch per click (EMAIL-013); "continue" runs the next batch.
  const sync = async () => {
    if (!firstConnection || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setOutcome(null);
    try {
      const response = await mutateAsync({ url: `/email-connections/${firstConnection.id}/sync`, method: "post", values: {} });
      setOutcome(outcomeOfRun((response as { data: SyncRun }).data));
    } catch (error) {
      setOutcome(outcomeOfError(error));
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
      void connectionsQuery.refetch();
      void runsQuery.refetch();
    }
  };

  const submitRule = async (values: ListenRuleFormValues) => {
    if (ruleInFlight.current) return;
    ruleInFlight.current = true;
    setSavingRule(true);
    setRuleError(null);
    try {
      await createRule({ resource: "email-listen-rules", values: { name: values.name, senderEmail: values.senderEmail, senderDomain: values.senderDomain, isEnabled: true } });
      setOpen(false);
      refetchRules();
    } catch (error) {
      // The dialog stays open so the user can correct the rule and save again.
      setRuleError(describeApiError(error));
    } finally {
      ruleInFlight.current = false;
      setSavingRule(false);
    }
  };

  const primaryAction = () => {
    if (!firstConnection || state?.action === "RECONNECT" || state?.action === "CONNECT") {
      const label = firstConnection ? "Kết nối lại Gmail" : "Kết nối Gmail";
      return <Button variant="primary" onClick={connect} disabled={connecting} icon={<Icon name="plus" width={15} />}>{connecting ? "Đang chuyển tới Google..." : label}</Button>;
    }
    const label = syncing ? "Đang đồng bộ..." : state?.action === "RETRY" ? "Thử đồng bộ lại" : "Đồng bộ ngay";
    return <Button onClick={sync} disabled={syncing || firstConnection.syncInProgress} icon={<Icon name="sync" width={15} className={syncing ? "animate-spin" : ""} />}>{label}</Button>;
  };

  const outcomeAction = (action: SyncOutcome["action"]) => {
    if (action === "CONTINUE") return <Button onClick={sync} disabled={syncing}>Tiếp tục đồng bộ</Button>;
    if (action === "RETRY") return <Button onClick={sync} disabled={syncing}>Thử lại</Button>;
    if (action === "RECONNECT") return <Button variant="primary" onClick={connect} disabled={connecting}>Kết nối lại Gmail</Button>;
    return undefined;
  };

  const renderConnection = () => {
    if (connectionsQuery.isLoading) return <Skeleton active paragraph={{ rows: 1 }} title={false} />;
    if (connectionsQuery.isError && !firstConnection) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-[var(--muted)]">
          <span>Không thể tải kết nối email. {describeApiError(connectionsQuery.error)}</span>
          <Button onClick={() => void connectionsQuery.refetch()} disabled={connectionsQuery.isFetching}>Thử lại</Button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[var(--accent)] text-white"><Icon name="email" width={23} height={23} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold">
            {firstConnection?.emailAddress ?? "Chưa kết nối Gmail"}
            {state && <Badge color={TONE_COLORS[state.tone]}>{state.label}</Badge>}
          </div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">
            {firstConnection
              ? `Đồng bộ thành công gần nhất: ${formatTime(firstConnection.lastSyncedAt)} · Lỗi gần nhất: ${formatTime(firstConnection.lastFailedAt)}`
              : "OAuth chỉ đọc"}
          </div>
          {firstConnection && (
            <div className="mt-0.5 text-[10.5px] text-[var(--faint)]">
              {firstConnection.backfillCompletedAt
                ? `Đã nhập xong dữ liệu ban đầu (${formatTime(firstConnection.backfillCompletedAt)})`
                : firstConnection.backfillFrom
                  ? `Đang nhập dữ liệu ban đầu từ ${formatTime(firstConnection.backfillFrom)}`
                  : "Chưa đồng bộ lần nào"}
            </div>
          )}
          {firstConnection?.errorMessage && <div className="mt-1 text-[11px] text-[var(--warn)]">{firstConnection.errorMessage}</div>}
        </div>
        {primaryAction()}
      </div>
    );
  };

  const renderRuns = () => {
    if (connectionsQuery.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
    if (!firstConnection) return <div className="py-6 text-center text-[12px] text-[var(--muted)]">Chưa có lượt đồng bộ.</div>;
    if (runsQuery.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
    if (runsQuery.isError && !runs.length) {
      return (
        <div className="flex flex-col items-center gap-3 py-6 text-center text-[12px] text-[var(--muted)]">
          <span>Không thể tải lịch sử đồng bộ. {describeApiError(runsQuery.error)}</span>
          <Button onClick={() => void runsQuery.refetch()} disabled={runsQuery.isFetching}>Thử lại</Button>
        </div>
      );
    }
    if (!runs.length) return <div className="py-6 text-center text-[12px] text-[var(--muted)]">Chưa có lượt đồng bộ.</div>;
    return runs.slice(0, 5).map((run) => {
      const status = RUN_STATUS[run.status] ?? { label: run.status, tone: "info" as const };
      return (
        <div key={run.id} className="border-b border-[var(--border)] py-3 text-[11px] last:border-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{formatTime(run.startedAt)}</span>
            <span className="flex items-center gap-2">
              {run.hasMore && <Badge color={TONE_COLORS.info}>Còn email</Badge>}
              <Badge color={TONE_COLORS[status.tone]}>{status.label}</Badge>
            </span>
          </div>
          <div className="mt-1 text-[10.5px] text-[var(--muted)]">{runCounts(run)}</div>
          {run.errorMessage && <div className="mt-0.5 text-[10.5px] text-[var(--faint)]">{run.errorMessage}</div>}
        </div>
      );
    });
  };

  return (
    <div className="space-y-5">
      <Card accent>{renderConnection()}</Card>

      {outcome && (
        <Alert
          type={outcome.tone}
          showIcon
          closable
          onClose={() => setOutcome(null)}
          message={outcome.title}
          description={outcome.detail}
          action={outcomeAction(outcome.action)}
        />
      )}

      <SectionHeading title="Rule lắng nghe" description="Chỉ email khớp rule mới được xử lý" action={<Button icon={<Icon name="plus" width={15} />} onClick={() => setOpen(true)}>Thêm rule</Button>} />
      <Card padding="p-0" className="overflow-hidden">
        {rules.length ? <div className="divide-y divide-[var(--border)]">{rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--surface-3)] text-[10.5px] font-bold">{rule.bank ?? "API"}</span><div className="min-w-[180px] flex-1"><div className="text-[12px] font-semibold">{rule.name}</div><div className="mt-0.5 truncate text-[10.5px] text-[var(--faint)]">{rule.senderEmail ?? rule.senderDomain ?? "Chưa cấu hình sender"}</div></div><div className="text-[10.5px] text-[var(--muted)]">{rule.lastMatchedAt ? new Date(rule.lastMatchedAt).toLocaleString("vi-VN") : "Chưa khớp"}</div><Switch defaultChecked={rule.isEnabled ?? false} /></div>)}</div> : <div className="p-8 text-center text-[12px] text-[var(--muted)]">Chưa có rule lắng nghe từ API.</div>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Lịch sử đồng bộ" description="Các lượt gần nhất" />
          {renderRuns()}
        </Card>
        <Card><SectionHeading title="Email cần xem lại" description="Parser chưa đủ độ tin cậy" /><AntButton size="small">Mở danh sách email</AntButton></Card>
      </div>

      <Modal title="Thêm rule lắng nghe" open={open} onCancel={() => { setOpen(false); setRuleError(null); }} footer={null}>
        {ruleError && <Alert type="error" showIcon className="mb-3" message="Không thể lưu rule" description={ruleError} />}
        <Form layout="vertical" onFinish={submitRule}>
          <Form.Item label="Tên rule" name="name"><Input placeholder="VCB · Biến động số dư" /></Form.Item>
          <Form.Item label="Địa chỉ người gửi" name="senderEmail"><Input placeholder="no-reply@bank.com.vn" /></Form.Item>
          <Form.Item label="Domain người gửi" name="senderDomain"><Input placeholder="bank.com.vn" /></Form.Item>
          <Button variant="primary" className="w-full" disabled={savingRule}>{savingRule ? "Đang lưu..." : "Lưu rule"}</Button>
        </Form>
      </Modal>
    </div>
  );
}
