import type { Alert } from "@/types/alert";
import type { Budget } from "@/types/budget";
import type { Goal } from "@/types/goal";
import type { Category, Transaction } from "@/types/transaction";

const alertTypeLabels: Record<string, string> = {
  BUDGET_THRESHOLD: "Ngân sách",
  LARGE_TRANSACTION: "Giao dịch lớn",
  CATEGORY_SPIKE: "Biến động danh mục",
  GOAL_RISK: "Rủi ro mục tiêu",
  CASHFLOW_RISK: "Rủi ro dòng tiền",
  SYSTEM_ERROR: "Lỗi hệ thống",
};

const goalTypeLabels: Record<string, string> = {
  PLANNED_PURCHASE: "Mua sắm dự định",
  EMERGENCY_FUND: "Quỹ dự phòng",
  DEBT_REPAYMENT: "Trả nợ",
  SAVING: "Tiết kiệm",
  INVESTMENT: "Đầu tư",
  TRAVEL: "Du lịch",
  EDUCATION: "Giáo dục",
  CUSTOM: "Mục tiêu khác",
};

export const mapCategory = (item: any): Category => ({
  id: item.id,
  name: item.name,
  type: String(item.type ?? "EXPENSE").toLowerCase() as Category["type"],
  color: item.color ?? "#9c968d",
});

const toDirection = (direction?: string): Transaction["dir"] => {
  if (direction === "INCOME") return "income";
  if (direction === "TRANSFER_IN" || direction === "TRANSFER_OUT") return "transfer";
  return "expense";
};

export const mapTransaction = (item: any): Transaction => ({
  id: item.id,
  time: item.transactionTime ? new Date(item.transactionTime).toLocaleString("vi-VN") : "",
  desc: item.description ?? item.normalizedDescription ?? "Giao dịch",
  merchant: item.merchantName ?? item.counterpartyName ?? item.bankName ?? "-",
  bank: item.account?.institutionName ?? item.bankName ?? "-",
  amount: Number(item.amount ?? 0),
  dir: toDirection(item.direction),
  cat: item.categoryId ?? "unknown",
  src: item.sourceType === "EMAIL" ? "email" : "manual",
});

export const mapBudget = (item: any): Budget => ({
  cat: item.categoryId ?? item.id,
  limit: Number(item.amount ?? 0),
  spent: Number(item.usage?.spent ?? 0),
  threshold: Number(item.thresholdPercent ?? 80),
});

export const mapGoal = (item: any): Goal => ({
  id: item.id,
  name: item.name,
  type: goalTypeLabels[item.type] ?? item.type ?? "Mục tiêu",
  target: Number(item.targetAmount ?? 0),
  saved: Number(item.savedAmount ?? 0),
  date: item.targetDate ? new Date(item.targetDate).toLocaleDateString("vi-VN") : "-",
  months: Number(item.months ?? 6),
  priority: item.priority ?? "MEDIUM",
});

const alertSeverity = (severity?: string): Alert["severity"] => {
  if (severity === "CRITICAL") return "critical";
  if (severity === "WARNING") return "warning";
  return "info";
};

export const mapAlert = (item: any): Alert => ({
  id: item.id,
  type: item.type,
  severity: alertSeverity(item.severity),
  typeLabel: alertTypeLabels[item.type] ?? String(item.type ?? "SYSTEM").replaceAll("_", " ").toLowerCase(),
  title: item.title,
  desc: item.message,
  time: item.createdAt ? new Date(item.createdAt).toLocaleString("vi-VN") : "",
});
