import type { Alert } from "@/types/alert";
import type { Budget } from "@/types/budget";
import type { Goal } from "@/types/goal";
import type { Category, Transaction } from "@/types/transaction";

export const CATEGORIES: Category[] = [
  { id: "sal", name: "Lương", type: "income", color: "#4a9d6e" },
  { id: "food", name: "Ăn uống", type: "expense", color: "#e07a3f" },
  { id: "coffee", name: "Cà phê", type: "expense", color: "#c98a5e" },
  { id: "move", name: "Di chuyển", type: "expense", color: "#5b8def" },
  { id: "shop", name: "Mua sắm", type: "expense", color: "#b06fd6" },
  { id: "bill", name: "Hóa đơn & tiện ích", type: "expense", color: "#d2604c" },
  { id: "fun", name: "Giải trí", type: "expense", color: "#e3a83f" },
  { id: "health", name: "Sức khỏe", type: "expense", color: "#3fb0a8" },
  { id: "save", name: "Tiết kiệm", type: "expense", color: "#6d8b3f" },
  { id: "transfer", name: "Chuyển khoản", type: "transfer", color: "#8a8378" },
];

export function getCat(id: string) {
  return CATEGORIES.find((category) => category.id === id) ?? {
    id: "unknown",
    name: "Chưa phân loại",
    type: "expense" as const,
    color: "#9c968d",
  };
}

export const TRANSACTIONS: Transaction[] = [
  { id: "t1", time: "Hôm nay · 08:12", desc: "Lương tháng 6/2026", merchant: "CÔNG TY ABC", bank: "VCB", amount: 24500000, dir: "income", cat: "sal", src: "email" },
  { id: "t2", time: "Hôm nay · 12:40", desc: "Thanh toán Highlands Coffee", merchant: "Highlands", bank: "TCB", amount: 78000, dir: "expense", cat: "coffee", src: "email" },
  { id: "t3", time: "Hôm nay · 19:05", desc: "Điện máy XANH - máy lọc nước", merchant: "Điện máy XANH", bank: "TCB", amount: 6500000, dir: "expense", cat: "shop", src: "email" },
  { id: "t4", time: "Hôm qua · 21:18", desc: "Grab - chuyến về nhà", merchant: "Grab", bank: "MB", amount: 62000, dir: "expense", cat: "move", src: "email" },
  { id: "t5", time: "14/06 · 12:30", desc: "Cơm trưa văn phòng", merchant: "Bếp nhà", bank: "MB", amount: 55000, dir: "expense", cat: "food", src: "manual" },
  { id: "t6", time: "13/06 · 09:22", desc: "Hóa đơn tiền điện EVN", merchant: "EVN HCMC", bank: "VCB", amount: 842000, dir: "expense", cat: "bill", src: "email" },
  { id: "t7", time: "13/06 · 20:44", desc: "Vé xem phim CGV", merchant: "CGV", bank: "ACB", amount: 220000, dir: "expense", cat: "fun", src: "email" },
  { id: "t8", time: "12/06 · 15:10", desc: "Chuyển tiền tiết kiệm", merchant: "Sổ tiết kiệm", bank: "VCB", amount: 5000000, dir: "transfer", cat: "transfer", src: "email" },
  { id: "t9", time: "12/06 · 10:02", desc: "Shopee - phụ kiện", merchant: "Shopee", bank: "TCB", amount: 389000, dir: "expense", cat: "shop", src: "email" },
  { id: "t10", time: "11/06 · 08:30", desc: "Nhà thuốc Long Châu", merchant: "Long Châu", bank: "MB", amount: 165000, dir: "expense", cat: "health", src: "email" },
  { id: "t11", time: "10/06 · 18:55", desc: "Đổ xăng Petrolimex", merchant: "Petrolimex", bank: "ACB", amount: 120000, dir: "expense", cat: "move", src: "email" },
  { id: "t12", time: "09/06 · 11:20", desc: "Freelance - thiết kế logo", merchant: "KHÁCH HÀNG X", bank: "VCB", amount: 3500000, dir: "income", cat: "sal", src: "email" },
];

export const MONTHS = [
  { m: "T1", income: 26800000, expense: 19200000 },
  { m: "T2", income: 25000000, expense: 21400000 },
  { m: "T3", income: 28200000, expense: 18800000 },
  { m: "T4", income: 27000000, expense: 23100000 },
  { m: "T5", income: 26500000, expense: 20300000 },
  { m: "T6", income: 28000000, expense: 20800000 },
];

export const BUDGETS: Budget[] = [
  { cat: "food", limit: 4000000, spent: 3120000, threshold: 80 },
  { cat: "move", limit: 1500000, spent: 980000, threshold: 80 },
  { cat: "shop", limit: 3000000, spent: 3260000, threshold: 90 },
  { cat: "fun", limit: 1200000, spent: 540000, threshold: 80 },
  { cat: "coffee", limit: 800000, spent: 712000, threshold: 90 },
  { cat: "bill", limit: 2500000, spent: 1640000, threshold: 85 },
];

export const GOALS: Goal[] = [
  { id: "car", name: "Mua xe máy", type: "Mua sắm dự định", target: 45000000, saved: 18000000, date: "12/2026", months: 6, priority: "Cao" },
  { id: "laptop", name: "Laptop làm việc", type: "Mua sắm dự định", target: 32000000, saved: 9500000, date: "10/2026", months: 4, priority: "Trung bình" },
  { id: "fund", name: "Quỹ dự phòng 6 tháng", type: "Emergency fund", target: 60000000, saved: 42000000, date: "06/2027", months: 12, priority: "Rất cao" },
];

export const ALERTS: Alert[] = [
  { id: "a1", type: "budget_threshold", severity: "critical", typeLabel: "Vượt ngân sách", title: 'Ngân sách "Mua sắm" đã vượt 100%', desc: "Đã chi 3.260.000₫ / 3.000.000₫ trong tháng này.", time: "2 giờ trước" },
  { id: "a2", type: "large_transaction", severity: "warning", typeLabel: "Giao dịch lớn", title: "Phát hiện giao dịch lớn", desc: "Chi 6.500.000₫ tại Điện máy XANH qua Techcombank.", time: "2 giờ trước" },
  { id: "a3", type: "goal_risk", severity: "warning", typeLabel: "Rủi ro mục tiêu", title: 'Mục tiêu "Mua xe máy" đang rủi ro', desc: "Cần tiết kiệm 4.500.000₫/tháng, cao hơn dòng tiền khả dụng.", time: "Hôm nay" },
  { id: "a4", type: "cashflow_risk", severity: "critical", typeLabel: "Dòng tiền", title: "Dòng tiền tháng 7 dự kiến âm", desc: "Chi dự kiến vượt thu 1.200.000₫ nếu giữ mức chi hiện tại.", time: "Hôm qua" },
  { id: "a5", type: "budget_threshold", severity: "warning", typeLabel: "Ngân sách", title: '"Cà phê" đã đạt 89% ngân sách', desc: "712.000₫ / 800.000₫ — còn 88.000₫ cho 15 ngày cuối tháng.", time: "2 ngày trước" },
];

export const ACCOUNTS = [
  { id: "a1", bank: "Vietcombank", code: "VCB", type: "Tài khoản thanh toán", number: "1903 •••• 4521", balance: 38420000, delta: 2.4, color: "#1f6f4a", series: [31, 33, 32, 35, 36, 37, 38.4] },
  { id: "a2", bank: "Techcombank", code: "TCB", type: "Tài khoản thanh toán", number: "1903 •••• 8842", balance: 13842000, delta: -3.1, color: "#d2604c", series: [18, 17.5, 16, 15.2, 14.8, 14.1, 13.8] },
  { id: "a3", bank: "MB Bank", code: "MB", type: "Tài khoản lương", number: "0099 •••• 1102", balance: 5244000, delta: 0.8, color: "#5b8def", series: [4.8, 5, 5.1, 5, 5.2, 5.18, 5.24] },
  { id: "a4", bank: "ACB", code: "ACB", type: "Thẻ tín dụng", number: "4311 •••• 7780", balance: -3380000, delta: -1.2, color: "#b06fd6", series: [-1.8, -2.2, -2.6, -2.9, -3.1, -3.3, -3.38] },
  { id: "a5", bank: "Vietcombank", code: "VCB", type: "Sổ tiết kiệm", number: "1903 •••• 9001", balance: 42000000, delta: 13.5, color: "#6d8b3f", series: [30, 32, 35, 37, 39, 41, 42] },
];

export const EMAIL_CONNECTIONS = [
  { id: "ec1", email: "nguyen.van.a@gmail.com", bank: "VCB", status: "connected" as const, lastSync: "2 phút trước" },
  { id: "ec2", email: "nguyenvana@work.com", bank: "TCB", status: "connected" as const, lastSync: "15 phút trước" },
  { id: "ec3", email: "personal@email.com", bank: "MB", status: "pending" as const, lastSync: "Chưa đồng bộ" },
  { id: "ec4", email: "nguyenvana@icloud.com", bank: "ACB", status: "error" as const, lastSync: "3 ngày trước" },
];

export const EMAIL_RULES = [
  { id: "r1", name: "Vietcombank · Biến động số dư", sender: "no-reply@info.vietcombank.com.vn", bank: "VCB", matched: "Hôm nay", active: true },
  { id: "r2", name: "Techcombank · Thông báo giao dịch", sender: "service@techcombank.com.vn", bank: "TCB", matched: "Hôm nay", active: true },
  { id: "r3", name: "MB Bank · Biến động", sender: "no-reply@mbbank.com.vn", bank: "MB", matched: "3 ngày trước", active: false },
  { id: "r4", name: "ACB · Giao dịch thẻ", sender: "notify@acb.com.vn", bank: "ACB", matched: "Hôm qua", active: true },
];

export const OPS_KPIS = [
  { label: "Email match rate", value: "87%", sub: "124 / 142 email", color: "var(--income)", series: [78, 80, 82, 84, 85, 86, 87] },
  { label: "Parse success rate", value: "92%", sub: "35 / 38 parser run", color: "var(--income)", series: [84, 86, 88, 90, 91, 91, 92] },
  { label: "Duplicate rate", value: "2,1%", sub: "3 / 142 giao dịch", color: "var(--accent)", series: [5, 4, 3.5, 3, 2.6, 2.3, 2.1] },
  { label: "Correction rate", value: "14%", sub: "manual / classified", color: "var(--warn)", series: [26, 24, 21, 19, 17, 15, 14] },
  { label: "Sync latency p95", value: "1,8s", sub: "10 lần sync gần nhất", color: "var(--text)", series: [2.6, 2.4, 2.2, 2, 1.9, 1.85, 1.8] },
  { label: "Notif delivery", value: "99%", sub: "sent / total", color: "var(--income)", series: [97, 98, 98, 99, 99, 99, 99] },
];
