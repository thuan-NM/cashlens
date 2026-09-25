import { useCustom, useList } from "@refinedev/core";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { describeApiError } from "@/api/mappers";
import type { ApiBankProvider, ApiParserTemplate } from "@/types/account";
import type { ApiAlert } from "@/types/alert";
import type { ApiEmailMessage } from "@/types/email";
import {
  type EmailConnection,
  type SyncRun,
  RUN_STATUS,
  TONE_COLORS,
  connectionState,
  runCounts,
} from "@/features/email-connections/sync-state";

const toArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }

  return [];
};

// The catalog status the API reports for a bank provider (BankProviderStatus).
const PROVIDER_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Hoạt động", color: "var(--income)" },
  INACTIVE: { label: "Ngừng hoạt động", color: "var(--muted)" },
  EXPERIMENTAL: { label: "Thử nghiệm", color: "var(--warn)" },
};

const providerStatus = (status: string | undefined) =>
  (status && PROVIDER_STATUS[status]) || { label: status || "Chưa rõ trạng thái", color: "var(--muted)" };

export function OpsPage() {
  const { result: bankProviders } = useList<ApiBankProvider>({ resource: "bank-providers", pagination: { mode: "off" } });
  const { result: parserTemplates } = useList<ApiParserTemplate>({ resource: "parser-templates", pagination: { mode: "off" } });
  const { result: emailMessages } = useList<ApiEmailMessage>({ resource: "email-messages", pagination: { currentPage: 1, pageSize: 20 } });
  const { result: alerts } = useList<ApiAlert>({ resource: "alerts", pagination: { currentPage: 1, pageSize: 20 } });
  const { result: connections } = useList<EmailConnection>({ resource: "email-connections", pagination: { mode: "off" } });
  const providerRows = toArray<ApiBankProvider>(bankProviders?.data);
  const templateRows = toArray<ApiParserTemplate>(parserTemplates?.data);
  const emailRows = toArray<ApiEmailMessage>(emailMessages?.data);
  const alertRows = toArray<ApiAlert>(alerts?.data);
  const connectionRows = toArray<EmailConnection>(connections?.data);
  const firstConnection = connectionRows[0];
  const { result: syncRuns, query: syncRunsQuery } = useCustom<SyncRun[]>({ url: firstConnection ? `/email-connections/${firstConnection.id}/sync-runs` : "/email-connections/none/sync-runs", method: "get", queryOptions: { enabled: Boolean(firstConnection) } });
  const syncRunRows = toArray<SyncRun>(syncRuns?.data);
  const health = firstConnection ? connectionState(firstConnection) : null;

  const kpis = [
    { label: "Ngân hàng hỗ trợ", value: providerRows.length, sub: "Catalog từ API", color: "var(--income)" },
    { label: "Parser template", value: templateRows.length, sub: "Mẫu bóc tách đang có", color: "var(--accent)" },
    { label: "Email đã lưu", value: emailMessages?.total ?? emailRows.length, sub: "Nguồn dữ liệu giao dịch", color: "var(--warn)" },
  ];
  const providers = providerRows;
  const templates = templateRows;
  const events = [
    // Sync status, counts, and continuation (EMAIL-005).
    ...syncRunRows.slice(0, 3).map((run) => {
      const status = RUN_STATUS[run.status] ?? { label: run.status, tone: "info" as const };
      return {
        time: run.startedAt,
        text: `Đồng bộ email — ${status.label}: ${runCounts(run)}${run.hasMore ? " · còn email chưa đồng bộ" : ""}${run.errorMessage ? ` · ${run.errorMessage}` : ""}`,
        color: TONE_COLORS[status.tone],
      };
    }),
    ...alertRows.slice(0, 3).map((alert) => ({ time: alert.createdAt, text: alert.title, color: alert.severity === "CRITICAL" ? "var(--expense)" : "var(--warn)" })),
  ].slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{kpis.map((item) => <Card key={item.label} hover><div className="text-[11.5px] font-medium text-[var(--muted)]">{item.label}</div><div className="mt-2 text-[21px] font-bold" style={{ color: item.color }}>{item.value}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{item.sub}</div></Card>)}</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding="p-4"><SectionHeading title="Nhà cung cấp ngân hàng" description="Catalog sender & parser template" />{providers.length ? <div className="divide-y divide-[var(--border)]">{providers.map((bank) => <div key={bank.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 sm:grid-cols-[1fr_1.4fr_1fr_auto]"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-3)] text-[10px] font-bold">{bank.code ?? bank.name?.slice(0, 3)}</span><b className="text-[11.5px]">{bank.name}</b></div><span className="hidden truncate text-[10.5px] text-[var(--faint)] sm:block">{bank.emailSenders?.[0]?.senderEmail ?? "Chưa có sender"}</span><code className="hidden text-[10px] text-[var(--muted)] sm:block">{templates.find((item) => item.bankProviderId === bank.id)?.name ?? "Chưa có template"}</code><span className="text-[10.5px] font-semibold" style={{ color: providerStatus(bank.status).color }}>{providerStatus(bank.status).label}</span></div>)}</div> : <div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có provider từ API.</div>}</Card>
        <Card padding="p-4"><SectionHeading title="Sự kiện pipeline gần đây" description="Sync · parser · classification · notification" />{health && <div className="mb-2 flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[11px]"><span className="truncate text-[var(--muted)]">{firstConnection?.emailAddress}</span><b style={{ color: TONE_COLORS[health.tone] }}>{health.label}</b></div>}{syncRunsQuery.isError && !syncRunRows.length && <div className="mb-2 text-[11px] text-[var(--warn)]">Không thể tải lịch sử đồng bộ. {describeApiError(syncRunsQuery.error)}</div>}{events.length ? <div className="divide-y divide-[var(--border)]">{events.map((event, index) => <div key={`${event.time}-${index}`} className="flex gap-3 py-3 text-[11px]"><code className="text-[var(--faint)]">{event.time ? new Date(event.time).toLocaleTimeString("vi-VN") : "-"}</code><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: event.color }} /><span className="leading-relaxed text-[var(--muted)]">{event.text}</span></div>)}</div> : <div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có sự kiện vận hành từ API.</div>}</Card>
      </div>
    </div>
  );
}
