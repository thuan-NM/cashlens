import { useCustom, useList } from "@refinedev/core";
import { SparkLine } from "@/components/charts/SparkLine";
import { Card } from "@/components/ui/Card";
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

export function OpsPage() {
  const { result: bankProviders } = useList<any>({ resource: "bank-providers", pagination: { mode: "off" } });
  const { result: parserTemplates } = useList<any>({ resource: "parser-templates", pagination: { mode: "off" } });
  const { result: emailMessages } = useList<any>({ resource: "email-messages", pagination: { currentPage: 1, pageSize: 20 } });
  const { result: alerts } = useList<any>({ resource: "alerts", pagination: { currentPage: 1, pageSize: 20 } });
  const { result: connections } = useList<any>({ resource: "email-connections", pagination: { mode: "off" } });
  const providerRows = toArray<any>(bankProviders?.data);
  const templateRows = toArray<any>(parserTemplates?.data);
  const emailRows = toArray<any>(emailMessages?.data);
  const alertRows = toArray<any>(alerts?.data);
  const connectionRows = toArray<any>(connections?.data);
  const firstConnection = connectionRows[0];
  const { result: syncRuns } = useCustom<any[]>({ url: firstConnection ? `/email-connections/${firstConnection.id}/sync-runs` : "/email-connections/none/sync-runs", method: "get", queryOptions: { enabled: Boolean(firstConnection) } });
  const syncRunRows = toArray<any>(syncRuns?.data);

  const kpis = [
    { label: "Ngân hàng hỗ trợ", value: providerRows.length, sub: "Catalog từ API", color: "var(--income)", series: [0, providerRows.length] },
    { label: "Parser template", value: templateRows.length, sub: "Mẫu bóc tách đang có", color: "var(--accent)", series: [0, templateRows.length] },
    { label: "Email đã lưu", value: emailMessages?.total ?? emailRows.length, sub: "Nguồn dữ liệu giao dịch", color: "var(--warn)", series: [0, emailRows.length] },
  ];
  const providers = providerRows;
  const templates = templateRows;
  const events = [
    ...syncRunRows.slice(0, 3).map((run: any) => ({ time: run.startedAt, text: `Đồng bộ email: ${run.emailsFound ?? 0} email, tạo ${run.transactionsCreated ?? 0} giao dịch`, color: "var(--income)" })),
    ...alertRows.slice(0, 3).map((alert: any) => ({ time: alert.createdAt, text: alert.title, color: alert.severity === "CRITICAL" ? "var(--expense)" : "var(--warn)" })),
  ].slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{kpis.map((item) => <Card key={item.label} hover><div className="flex items-start justify-between gap-3"><div className="text-[11.5px] font-medium text-[var(--muted)]">{item.label}</div><SparkLine data={item.series} color={item.color} width={64} height={25} /></div><div className="mt-2 text-[21px] font-bold" style={{ color: item.color }}>{item.value}</div><div className="mt-1 text-[10.5px] text-[var(--faint)]">{item.sub}</div></Card>)}</div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card padding="p-4"><SectionHeading title="Nhà cung cấp ngân hàng" description="Catalog sender & parser template" />{providers.length ? <div className="divide-y divide-[var(--border)]">{providers.map((bank: any) => <div key={bank.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 sm:grid-cols-[1fr_1.4fr_1fr_auto]"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--surface-3)] text-[10px] font-bold">{bank.code ?? bank.name?.slice(0, 3)}</span><b className="text-[11.5px]">{bank.name}</b></div><span className="hidden truncate text-[10.5px] text-[var(--faint)] sm:block">{bank.emailSenders?.[0]?.senderEmail ?? "Chưa có sender"}</span><code className="hidden text-[10px] text-[var(--muted)] sm:block">{templates.find((item: any) => item.bankProviderId === bank.id)?.name ?? "Chưa có template"}</code><span className="text-[10.5px] font-semibold text-[var(--income)]">Hoạt động</span></div>)}</div> : <div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có provider từ API.</div>}</Card>
        <Card padding="p-4"><SectionHeading title="Sự kiện pipeline gần đây" description="Sync · parser · classification · notification" />{events.length ? <div className="divide-y divide-[var(--border)]">{events.map((event, index) => <div key={`${event.time}-${index}`} className="flex gap-3 py-3 text-[11px]"><code className="text-[var(--faint)]">{event.time ? new Date(event.time).toLocaleTimeString("vi-VN") : "-"}</code><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: event.color }} /><span className="leading-relaxed text-[var(--muted)]">{event.text}</span></div>)}</div> : <div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có sự kiện vận hành từ API.</div>}</Card>
      </div>
    </div>
  );
}
