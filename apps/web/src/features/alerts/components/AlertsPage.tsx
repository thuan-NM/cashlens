import { useState } from "react";
import { Alert as Notice, App as AntdApp, Segmented, Skeleton } from "antd";
import { useCustom, useCustomMutation, useList } from "@refinedev/core";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { describeApiError, mapAlert, mapAlertSetting } from "@/api/mappers";
import { ROUTES } from "@/config/routes";
import type { Alert, AlertEmailDelivery, AlertStatus, ApiAlert, ApiAlertSetting } from "@/types/alert";
import { notifyAlertsChanged } from "@/utils/alertEvents";

type StatusFilter = AlertStatus | "ALL";

/** Lifecycle status (ALERT-010): independent of whether the alert was read. */
const statusLabels: Record<AlertStatus, { label: string; color: string }> = {
  ACTIVE: { label: "Đang mở", color: "var(--expense)" },
  DISMISSED: { label: "Đã ẩn", color: "var(--muted)" },
  RESOLVED: { label: "Đã xử lý", color: "var(--income)" },
};

const resolutionLabels: Record<string, string> = {
  BELOW_THRESHOLD: "điều kiện không còn đúng",
  PERIOD_ENDED: "kỳ ngân sách đã kết thúc",
  TARGET_REMOVED: "đối tượng đã bị xóa hoặc tạm dừng",
  INSUFFICIENT_DATA: "chưa đủ dữ liệu",
  CONDITION_CLEARED: "điều kiện không còn đúng",
  RECONNECTED: "đã kết nối lại",
  DISCONNECTED: "đã ngắt kết nối",
  SYNC_SUCCEEDED: "đồng bộ đã thành công",
};

const skipLabels: Record<string, string> = {
  NOT_CRITICAL: "chỉ cảnh báo nghiêm trọng mới được gửi email",
  EMAIL_DISABLED: "bạn chưa bật email cho loại cảnh báo này",
  NOTIFICATIONS_DISABLED: "bạn đã tắt thông báo",
  TRANSPORT_DISABLED: "máy chủ chưa bật gửi email",
};

const failureLabels: Record<string, string> = {
  TIMEOUT: "hết thời gian chờ",
  CONNECTION: "không kết nối được máy chủ email",
  TEMPORARY: "máy chủ email tạm thời từ chối",
  REJECTED: "máy chủ email từ chối",
  AUTH: "máy chủ email từ chối xác thực",
  INTERRUPTED: "bị gián đoạn, không gửi lại",
};

/** The email outcome (ALERT-005/006); user-authored and older alerts have none. */
const deliveryText = (delivery: AlertEmailDelivery | null) => {
  if (!delivery) return { text: "Chỉ trong ứng dụng", color: "var(--faint)" };
  switch (delivery.status) {
    case "SENT":
      return { text: "Email: đã gửi", color: "var(--income)" };
    case "PENDING":
      return { text: "Email: đang gửi", color: "var(--muted)" };
    case "SKIPPED":
      return {
        text: `Email: không gửi (${skipLabels[delivery.skipReason ?? ""] ?? delivery.skipReason ?? "-"})`,
        color: "var(--faint)",
      };
    case "FAILED":
      return {
        text: `Email: gửi thất bại sau ${delivery.attemptCount} lần (${failureLabels[delivery.failureCode ?? ""] ?? delivery.failureCode ?? "-"})`,
        color: "var(--expense)",
      };
    default:
      return { text: "Email: -", color: "var(--faint)" };
  }
};

const severityColor = (alert: Alert) =>
  alert.severity === "critical" ? "var(--expense)" : alert.severity === "warning" ? "var(--warn)" : "var(--accent)";

function AlertCard({
  alert,
  busy,
  onRead,
  onDismiss,
}: {
  alert: Alert;
  busy: boolean;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const color = severityColor(alert);
  const status = statusLabels[alert.status];
  const delivery = deliveryText(alert.emailDelivery);
  return (
    <Card>
      <div className="flex gap-3" data-testid={`alert-${alert.id}`}>
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: alert.isRead ? "transparent" : color, border: `1.5px solid ${color}` }}
          aria-label={alert.isRead ? "Đã đọc" : "Chưa đọc"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md px-2 py-1 text-[10px] font-bold uppercase" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>
              {alert.typeLabel}
            </span>
            <span className="rounded-md px-2 py-1 text-[10px] font-semibold" style={{ color: status.color, background: "var(--surface-2)" }} data-testid="alert-status">
              {status.label}
            </span>
            <span className="ml-auto text-[10.5px] text-[var(--faint)]">{alert.time}</span>
          </div>
          <div className="mt-2 text-[13px] font-semibold">{alert.title}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{alert.desc}</p>
          {alert.status === "RESOLVED" && (
            <p className="mt-1 text-[10.5px] text-[var(--faint)]">
              Đã tự động xử lý: {resolutionLabels[alert.resolutionReason ?? ""] ?? alert.resolutionReason ?? "-"}
              {alert.dismissedAt ? " · đã được ẩn trước đó" : ""}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10.5px]" style={{ color: delivery.color }} data-testid="alert-delivery">
              {delivery.text}
            </span>
            <span className="ml-auto flex gap-2">
              {!alert.isRead && (
                <Button onClick={onRead} disabled={busy}>
                  Đánh dấu đã đọc
                </Button>
              )}
              {alert.status === "ACTIVE" && (
                <Button onClick={onDismiss} disabled={busy}>
                  Ẩn
                </Button>
              )}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function AlertsPage() {
  const { message } = AntdApp.useApp();
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [busyId, setBusyId] = useState<string | null>(null);
  const filters = status === "ALL" ? [] : [{ field: "status", operator: "eq" as const, value: status }];
  const { result, query } = useList<ApiAlert>({ resource: "alerts", filters, pagination: { currentPage: 1, pageSize: 50 } });
  const unreadQuery = useCustom<{ count: number }>({ url: "/alerts/unread-count", method: "get" });
  const settingsQuery = useCustom<ApiAlertSetting[]>({ url: "/alerts/settings", method: "get" });
  const { mutateAsync } = useCustomMutation();

  const alerts = query.data ? (result?.data ?? []).map(mapAlert) : null;
  const unread = unreadQuery.query.data?.data?.count;
  const emailAvailable = (settingsQuery.query.data?.data ?? []).map(mapAlertSetting)[0]?.emailAvailable;

  const refresh = () => {
    void query.refetch();
    void unreadQuery.query.refetch();
    notifyAlertsChanged();
  };

  const act = async (id: string | null, url: string, done: string) => {
    setBusyId(id ?? "all");
    try {
      await mutateAsync({ url, method: "patch", values: {}, successNotification: false, errorNotification: false });
      message.success(done);
    } catch (error) {
      message.error(describeApiError(error));
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const list = (() => {
    if (!alerts) {
      return (
        <Card>
          {query.isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center text-[12px] text-[var(--muted)]">
              <span>Không thể tải cảnh báo. {describeApiError(query.error)}</span>
              <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? "Đang thử lại..." : "Thử lại"}
              </Button>
            </div>
          ) : (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
        </Card>
      );
    }
    if (!alerts.length) {
      return (
        <Card>
          <div className="py-8 text-center text-[12px] text-[var(--muted)]">
            {status === "ACTIVE" ? "Không có cảnh báo đang mở." : "Không có cảnh báo nào ở trạng thái này."}
          </div>
        </Card>
      );
    }
    return alerts.map((alert) => (
      <AlertCard
        key={alert.id}
        alert={alert}
        busy={busyId !== null}
        onRead={() => void act(alert.id, `/alerts/${alert.id}/read`, "Đã đánh dấu đã đọc")}
        onDismiss={() => void act(alert.id, `/alerts/${alert.id}/dismiss`, "Đã ẩn cảnh báo")}
      />
    ));
  })();

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionHeading title="Cảnh báo" description="Trạng thái xử lý độc lập với việc đã đọc" />
          <Segmented
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { label: "Đang mở", value: "ACTIVE" },
              { label: "Đã ẩn", value: "DISMISSED" },
              { label: "Đã xử lý", value: "RESOLVED" },
              { label: "Tất cả", value: "ALL" },
            ]}
          />
        </div>
        {query.isError && alerts && (
          <Notice
            className="mb-3"
            type="warning"
            showIcon
            message={`Không thể làm mới danh sách. ${describeApiError(query.error)}`}
            action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
          />
        )}
        <div className="space-y-3">{list}</div>
      </div>
      <div className="space-y-4">
        <Card className="h-fit">
          <SectionHeading title="Chưa đọc" description="Đếm mọi cảnh báo chưa đọc, kể cả đã xử lý" />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[26px] font-bold tabular-nums" data-testid="unread-count">
              {unreadQuery.query.isError ? "-" : unread ?? "…"}
            </span>
            <Button onClick={() => void act(null, "/alerts/read-all", "Đã đánh dấu tất cả là đã đọc")} disabled={busyId !== null || !unread}>
              Đọc tất cả
            </Button>
          </div>
          {unreadQuery.query.isError && (
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              Không thể tải số cảnh báo chưa đọc.{" "}
              <button className="font-semibold text-[var(--accent)]" onClick={() => void unreadQuery.query.refetch()}>
                Thử lại
              </button>
            </div>
          )}
        </Card>
        <Card className="h-fit">
          <SectionHeading title="Kênh thông báo" description="Cảnh báo luôn hiển thị trong ứng dụng" />
          <p className="text-[11.5px] leading-relaxed text-[var(--muted)]">
            Email chỉ gửi cho cảnh báo nghiêm trọng của loại bạn đã bật, và chỉ báo có cảnh báo mới — không kèm số tiền hay chi tiết giao dịch.
          </p>
          {emailAvailable === false && (
            <Notice className="mt-3" type="info" showIcon message="Gửi email chưa khả dụng trên máy chủ này." data-testid="email-unavailable" />
          )}
          <Link to={ROUTES.SETTINGS} className="mt-3 inline-block text-[11.5px] font-semibold text-[var(--accent)]">
            Cài đặt cảnh báo →
          </Link>
        </Card>
      </div>
    </div>
  );
}
