import { useLocation, useNavigate } from "react-router";
import { Drawer, Input } from "antd";
import { ALERTS } from "@/config/mockData";
import { Icon } from "@/components/ui/Icon";
import { useThemeStore } from "@/stores/themeStore";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";

const pageMeta: Record<string, [string, string]> = {
  dashboard: ["Tổng quan", "Tháng 6, 2026 · Asia/Ho_Chi_Minh"],
  transactions: ["Giao dịch", "Quản lý & review giao dịch"],
  accounts: ["Tài khoản", "Số dư & nguồn tiền theo ngân hàng"],
  budgets: ["Ngân sách", "Theo dõi chi tiêu theo nhóm"],
  goals: ["Dự định tài chính", "Mục tiêu & mô phỏng khả thi"],
  alerts: ["Thông báo & Cảnh báo", "Smart alerts tự xây dựng"],
  email: ["Kết nối email", "Nguồn dữ liệu giao dịch"],
  ops: ["Vận hành", "Observability pipeline & nhà cung cấp"],
  settings: ["Cài đặt", "Hồ sơ, quyền riêng tư & thông báo"],
};

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const key = location.pathname.split("/").pop() ?? "dashboard";
  const [title, subtitle] = pageMeta[key] ?? pageMeta.dashboard;
  const mode = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const open = useUiStore((state) => state.notificationOpen);
  const setOpen = useUiStore((state) => state.setNotificationOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const readAlerts = useUiStore((state) => state.readAlerts);
  const markAlertRead = useUiStore((state) => state.markAlertRead);
  const markAllAlertsRead = useUiStore((state) => state.markAllAlertsRead);
  const logout = useAuthStore((state) => state.logout);
  const unread = ALERTS.filter((alert) => !readAlerts.includes(alert.id));

  return (
    <>
      <header className="glass-panel sticky top-0 z-30 flex h-[69px] items-center gap-3 border-b border-[var(--border)] px-3.5 sm:px-[18px]">
        <button onClick={() => setMobileNavOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--surface)] md:hidden">
          <Icon name="menu" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[16.5px] font-bold tracking-tight">{title}</h1>
          <p className="truncate text-[11.5px] text-[var(--faint)]">{subtitle}</p>
        </div>
        <div className="ml-auto hidden w-full max-w-[330px] lg:block">
          <Input prefix={<Icon name="search" width={16} />} placeholder="Tìm giao dịch, tài khoản..." />
        </div>
        <button onClick={toggleTheme} className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]">
          <Icon name={mode === "dark" ? "sun" : "moon"} />
        </button>
        <button onClick={() => setOpen(true)} className="relative flex h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]">
          <Icon name="bell" />
          {unread.length > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--expense)] ring-2 ring-[var(--surface)]" />}
        </button>
        <button
          title="Đăng xuất"
          onClick={() => {
            logout();
            navigate("/");
          }}
          className="hidden h-10 w-10 items-center justify-center rounded-[11px] border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] sm:flex"
        >
          <Icon name="logout" />
        </button>
      </header>
      <Drawer
        title={<div><div className="font-bold">Thông báo</div><div className="text-[11px] font-normal text-[var(--faint)]">{unread.length} thông báo chưa đọc</div></div>}
        open={open}
        onClose={() => setOpen(false)}
        width={380}
        extra={<button onClick={() => markAllAlertsRead(ALERTS.map((alert) => alert.id))} className="text-[11.5px] font-semibold text-[var(--accent)]">Đọc tất cả</button>}
      >
        <div className="flex flex-col gap-2">
          {ALERTS.map((alert) => {
            const read = readAlerts.includes(alert.id);
            const color = alert.severity === "critical" ? "var(--expense)" : alert.severity === "warning" ? "var(--warn)" : "var(--accent)";
            return (
              <button
                key={alert.id}
                onClick={() => markAlertRead(alert.id)}
                className="rounded-[13px] border border-[var(--border)] p-3 text-left transition"
                style={{ background: read ? "transparent" : "var(--surface)", opacity: read ? 0.65 : 1 }}
              >
                <div className="flex gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{alert.typeLabel}</span>
                      <span className="ml-auto text-[10px] text-[var(--faint)]">{alert.time}</span>
                    </div>
                    <div className="mt-1.5 text-[12px] font-semibold">{alert.title}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{alert.desc}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Drawer>
    </>
  );
}
