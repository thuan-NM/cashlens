import { Select, Switch } from "antd";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useThemeStore } from "@/stores/themeStore";

export function SettingsPage() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><SectionHeading title="Hồ sơ" description="Thông tin tài khoản CashLens" /><div className="flex items-center gap-4 rounded-xl bg-[var(--surface-2)] p-4"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#e07a3f] to-[#d2604c] font-bold text-white">MT</span><div><div className="font-semibold">Nguyễn Minh Thuận</div><div className="text-[11px] text-[var(--faint)]">thuan.nguyen@gmail.com</div></div></div><div className="mt-4 divide-y divide-[var(--border)]">{[["Gói hiện tại", "Cá nhân"], ["Ngày tham gia", "12/06/2026"], ["Trạng thái", "Đã xác minh"]].map((row) => <div key={row[0]} className="flex justify-between py-3 text-[11.5px]"><span className="text-[var(--muted)]">{row[0]}</span><b>{row[1]}</b></div>)}</div></Card>
      <Card><SectionHeading title="Giao diện & khu vực" /><div className="space-y-4"><label className="block text-[11.5px]"><span className="mb-2 block text-[var(--muted)]">Chế độ giao diện</span><Select className="w-full" value={theme} onChange={setTheme} options={[{ label: "Sáng", value: "light" }, { label: "Tối", value: "dark" }]} /></label><label className="block text-[11.5px]"><span className="mb-2 block text-[var(--muted)]">Tiền tệ cơ sở</span><Select className="w-full" defaultValue="VND" options={[{ label: "VND · Việt Nam đồng", value: "VND" }]} /></label><label className="block text-[11.5px]"><span className="mb-2 block text-[var(--muted)]">Múi giờ</span><Select className="w-full" defaultValue="Asia/Ho_Chi_Minh" options={[{ label: "Asia/Ho_Chi_Minh", value: "Asia/Ho_Chi_Minh" }]} /></label></div></Card>
      <Card><SectionHeading title="Tự động hóa" description="Kiểm soát cách hệ thống xử lý dữ liệu" /><div className="divide-y divide-[var(--border)]">{[["Phân loại tự động", "Rule + mô hình phân loại"], ["AI insight", "Phân tích dữ liệu đã tổng hợp"], ["Email feedback", "Học từ chỉnh sửa thủ công"], ["Lưu email gốc", "Mặc định tắt để bảo vệ riêng tư"]].map((item, index) => <div key={item[0]} className="flex items-center justify-between py-3"><div><div className="text-[11.5px] font-medium">{item[0]}</div><div className="text-[10px] text-[var(--faint)]">{item[1]}</div></div><Switch defaultChecked={index < 3} /></div>)}</div></Card>
      <Card><SectionHeading title="Quyền riêng tư" description="OAuth chỉ đọc, dữ liệu tối thiểu" /><div className="space-y-3 text-[11.5px] leading-relaxed text-[var(--muted)]"><div className="rounded-xl bg-[var(--surface-2)] p-4"><b className="text-[var(--text)]">Không lưu mật khẩu ngân hàng.</b><br />CashLens chỉ nhận quyền đọc email qua OAuth và không thể gửi, sửa hoặc xóa email.</div><div className="rounded-xl bg-[var(--surface-2)] p-4"><b className="text-[var(--text)]">Email gốc không được lưu mặc định.</b><br />Chỉ dữ liệu giao dịch đã bóc tách được giữ lại để tổng hợp tài chính.</div></div></Card>
    </div>
  );
}
