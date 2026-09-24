import { useEffect, useState } from "react";
import { Alert as Notice, App as AntdApp, InputNumber, Skeleton, Switch } from "antd";
import { useCustom, useCustomMutation } from "@refinedev/core";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { alertTypeLabels, describeApiError, mapAlertSetting } from "@/api/mappers";
import type { AlertSetting, ApiAlertSetting } from "@/types/alert";

/** The ALERT-009 types of this release, and which can ever be CRITICAL (emailed). */
const TYPES: { type: string; hint: string; emailable: boolean }[] = [
  { type: "BUDGET_THRESHOLD", hint: "Cảnh báo ở ngưỡng của bạn; nghiêm trọng khi vượt 100% ngân sách tháng", emailable: true },
  { type: "LARGE_TRANSACTION", hint: "Một khoản chi từ ngưỡng giao dịch lớn trở lên trong tháng hiện tại", emailable: false },
  { type: "GOAL_RISK", hint: "Số cần tiết kiệm mỗi tháng vượt dòng tiền khả dụng", emailable: false },
  { type: "CASHFLOW_RISK", hint: "Dòng tiền ròng trung bình các tháng gần nhất âm (nghiêm trọng)", emailable: true },
  { type: "SYSTEM", hint: "Đồng bộ email lỗi liên tiếp, hoặc cần kết nối lại Gmail (nghiêm trọng)", emailable: true },
];

/**
 * Per-type alert settings (ALERT-005, CFG-007): in-app on by default; email
 * only for critical alerts, only while in-app is on, and only when the
 * server can send email. The large-transaction threshold is in the base
 * currency and must be greater than 0; empty means the default (5,000,000
 * for VND, otherwise off).
 */
export function AlertSettingsCard() {
  const { message } = AntdApp.useApp();
  const settingsQuery = useCustom<ApiAlertSetting[]>({ url: "/alerts/settings", method: "get" });
  const { mutateAsync } = useCustomMutation();
  const [saving, setSaving] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);

  const settings = settingsQuery.query.data ? (settingsQuery.query.data.data ?? []).map(mapAlertSetting) : null;
  const byType = new Map((settings ?? []).map((setting) => [setting.type, setting]));
  const emailAvailable = settings?.[0]?.emailAvailable ?? false;
  const storedThreshold = byType.get("LARGE_TRANSACTION")?.threshold ?? null;

  useEffect(() => setThreshold(storedThreshold), [storedThreshold]);

  const save = async (type: string, values: Partial<AlertSetting>) => {
    setSaving(type);
    try {
      await mutateAsync({
        url: "/alerts/settings",
        method: "patch",
        values: { type, ...values },
        successNotification: false,
        errorNotification: false,
      });
      message.success("Đã lưu cài đặt cảnh báo");
    } catch (error) {
      message.error(describeApiError(error));
    } finally {
      setSaving(null);
      void settingsQuery.query.refetch();
    }
  };

  if (!settings) {
    return (
      <Card>
        <SectionHeading title="Cảnh báo" description="Kênh nhận cảnh báo theo từng loại" />
        {settingsQuery.query.isError ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center text-[12px] text-[var(--muted)]">
            <span>Không thể tải cài đặt cảnh báo. {describeApiError(settingsQuery.query.error)}</span>
            <Button onClick={() => void settingsQuery.query.refetch()}>Thử lại</Button>
          </div>
        ) : (
          <Skeleton active paragraph={{ rows: 4 }} />
        )}
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeading title="Cảnh báo" description="Kênh nhận cảnh báo theo từng loại" />
      {!emailAvailable && (
        <Notice className="mb-3" type="info" showIcon message="Gửi email chưa khả dụng trên máy chủ này; cảnh báo vẫn hiển thị trong ứng dụng." data-testid="email-unavailable" />
      )}
      <div className="divide-y divide-[var(--border)]" data-testid="alert-settings">
        {TYPES.map(({ type, hint, emailable }) => {
          const setting = byType.get(type) ?? { type, inAppEnabled: true, emailEnabled: false, threshold: null, emailAvailable };
          const emailDisabled = !emailAvailable || !setting.inAppEnabled || !emailable || saving !== null;
          const emailHint = !emailable
            ? "Không gửi email: loại này không có mức nghiêm trọng"
            : !setting.inAppEnabled
              ? "Bật trong ứng dụng trước khi bật email"
              : !emailAvailable
                ? "Email chưa khả dụng"
                : "Email khi có cảnh báo nghiêm trọng mới";
          return (
            <div key={type} className="py-3" data-testid={`alert-setting-${type}`}>
              <div className="text-[11.5px] font-medium">{alertTypeLabels[type] ?? type}</div>
              <div className="mt-0.5 text-[10px] text-[var(--faint)]">{hint}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
                <label className="flex items-center gap-2">
                  <Switch
                    size="small"
                    checked={setting.inAppEnabled}
                    disabled={saving !== null || (setting.inAppEnabled && setting.emailEnabled)}
                    onChange={(checked) => void save(type, { inAppEnabled: checked })}
                    aria-label={`${alertTypeLabels[type]}: trong ứng dụng`}
                  />
                  Trong ứng dụng
                </label>
                <label className="flex items-center gap-2" title={emailHint}>
                  <Switch
                    size="small"
                    checked={setting.emailEnabled}
                    disabled={emailDisabled && !setting.emailEnabled}
                    onChange={(checked) => void save(type, { emailEnabled: checked })}
                    aria-label={`${alertTypeLabels[type]}: email`}
                  />
                  Email
                </label>
                <span className="text-[10px] text-[var(--faint)]">{emailHint}</span>
              </div>
              {setting.inAppEnabled && setting.emailEnabled && (
                <div className="mt-1 text-[10px] text-[var(--faint)]">Tắt email trước khi tắt cảnh báo trong ứng dụng.</div>
              )}
              {type === "LARGE_TRANSACTION" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-[var(--muted)]">Ngưỡng giao dịch lớn</span>
                  <InputNumber
                    min={0.01}
                    value={threshold}
                    onChange={(value) => setThreshold(typeof value === "number" ? value : null)}
                    placeholder="5000000 (mặc định cho VND)"
                    style={{ width: 200 }}
                    aria-label="Ngưỡng giao dịch lớn"
                  />
                  <Button
                    onClick={() => void save(type, { threshold })}
                    disabled={saving !== null || threshold === storedThreshold || (threshold !== null && threshold <= 0)}
                  >
                    Lưu ngưỡng
                  </Button>
                  <span className="text-[10px] text-[var(--faint)]">Theo tiền tệ cơ sở; để trống để dùng mặc định. Chỉ áp dụng cho giao dịch mới.</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
