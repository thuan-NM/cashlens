import { useState } from "react";
import { Segmented, Switch } from "antd";
import { useCustomMutation, useList } from "@refinedev/core";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { mapAlert } from "@/api/mappers";

const severityMap: Record<string, string | undefined> = { all: undefined, critical: "CRITICAL", warning: "WARNING" };

export function AlertsPage() {
  const [filter, setFilter] = useState("all");
  const filters = severityMap[filter] ? [{ field: "severity", operator: "eq" as const, value: severityMap[filter] }] : [];
  const { result: data, query: { refetch } } = useList<any>({ resource: "alerts", filters, pagination: { currentPage: 1, pageSize: 50 } });
  const { mutateAsync } = useCustomMutation();
  const alerts = data?.data?.map(mapAlert) ?? [];

  const markRead = async (id: string) => {
    await mutateAsync({ url: `/alerts/${id}/read`, method: "patch", values: {} });
    refetch();
  };

  return <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]"><div><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><SectionHeading title="Cảnh báo gần đây" description="Ưu tiên theo mức độ ảnh hưởng" /><Segmented value={filter} onChange={(value) => setFilter(String(value))} options={[{ label: "Tất cả", value: "all" }, { label: "Nghiêm trọng", value: "critical" }, { label: "Cảnh báo", value: "warning" }]} /></div><div className="space-y-3">{alerts.length ? alerts.map((alert) => { const color = alert.severity === "critical" ? "var(--expense)" : alert.severity === "warning" ? "var(--warn)" : "var(--accent)"; return <button key={alert.id} onClick={() => markRead(alert.id)} className="w-full text-left"><Card><div className="flex gap-3"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md px-2 py-1 text-[10px] font-bold uppercase" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>{alert.typeLabel}</span><span className="ml-auto text-[10.5px] text-[var(--faint)]">{alert.time}</span></div><div className="mt-2 text-[13px] font-semibold">{alert.title}</div><p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{alert.desc}</p></div></div></Card></button>; }) : <Card><div className="py-8 text-center text-[12px] text-[var(--muted)]">Chưa có cảnh báo từ API.</div></Card>}</div></div><Card className="h-fit"><SectionHeading title="Cài đặt cảnh báo" description="Kênh nhận thông báo" /><div className="divide-y divide-[var(--border)]">{["Vượt ngưỡng ngân sách", "Giao dịch lớn", "Biến động danh mục", "Rủi ro mục tiêu", "Rủi ro dòng tiền", "Lỗi hệ thống"].map((item, index) => <div key={item} className="flex items-center justify-between gap-3 py-3"><div><div className="text-[11.5px] font-medium">{item}</div><div className="mt-0.5 text-[10px] text-[var(--faint)]">{index < 2 ? "In-app + Email" : "In-app"}</div></div><Switch defaultChecked /></div>)}</div></Card></div>;
}
