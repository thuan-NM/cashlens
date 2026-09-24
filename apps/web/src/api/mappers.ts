import { ApiError } from "@/api/client";
import type { Alert } from "@/types/alert";
import type { Budget } from "@/types/budget";
import type { Goal } from "@/types/goal";
import type { Category, Transaction } from "@/types/transaction";
import { formatDateTime } from "@/utils/format";

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

/** The transaction fields of the API response that the web client reads. */
export type TransactionPayload = {
  id: string;
  amount?: number | string | null;
  currency?: string | null;
  direction?: string | null;
  status?: string | null;
  isDuplicate?: boolean | null;
  duplicateOfTransactionId?: string | null;
  categoryId?: string | null;
  category?: { name?: string | null; color?: string | null } | null;
  transactionTime?: string | null;
  userNote?: string | null;
  description?: string | null;
  normalizedDescription?: string | null;
  merchantName?: string | null;
  counterpartyName?: string | null;
  bankName?: string | null;
  sourceType?: string | null;
  account?: { institutionName?: string | null } | null;
};

/**
 * A persisted transaction with the state the list, detail drawer, and dashboard
 * show: raw direction and status, duplicate link, currency, and note (TX-001).
 * `flow` only picks the displayed sign; totals always come from the API.
 */
export interface TransactionRecord extends Transaction {
  direction: string;
  flow: "income" | "expense" | "neutral";
  currency: string;
  status: string;
  isDuplicate: boolean;
  duplicateOfTransactionId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  userNote: string;
  transactionTime: string;
}

const toFlow = (direction?: string | null): TransactionRecord["flow"] => {
  if (direction === "INCOME") return "income";
  if (direction === "EXPENSE") return "expense";
  return "neutral";
};

export const mapTransactionRecord = (item: TransactionPayload, timeZone?: string): TransactionRecord => ({
  ...mapTransaction(item),
  time: formatDateTime(item.transactionTime, timeZone),
  direction: String(item.direction ?? ""),
  flow: toFlow(item.direction),
  currency: String(item.currency ?? ""),
  status: String(item.status ?? ""),
  isDuplicate: Boolean(item.isDuplicate),
  duplicateOfTransactionId: item.duplicateOfTransactionId ?? null,
  categoryId: item.categoryId ?? null,
  categoryName: item.category?.name ?? null,
  categoryColor: item.category?.color ?? null,
  userNote: item.userNote ?? "",
  transactionTime: item.transactionTime ?? "",
});

const apiMessages = (error: ApiError): string[] => {
  const raw = (error.body as { message?: unknown } | null)?.message;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw) return [raw];
  return error.message ? [error.message] : [];
};

/** A user-facing message for a failed request (ERR-005): validation, authorization, missing, or unavailable. */
export const describeApiError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.sessionRenewed) return "Phiên đăng nhập vừa được gia hạn. Vui lòng thử lại.";
    if (error.status === 400) return apiMessages(error).join("; ") || "Dữ liệu không hợp lệ.";
    if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    if (error.status === 403) return "Bạn không có quyền thực hiện thao tác này.";
    if (error.status === 404) return "Không tìm thấy dữ liệu. Có thể dữ liệu đã bị xóa.";
    if (error.status >= 500) return "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.";
    return error.message || "Yêu cầu không thành công.";
  }
  if (error instanceof TypeError) return "Không thể kết nối tới máy chủ. Kiểm tra kết nối rồi thử lại.";
  if (error instanceof SyntaxError) return "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.";
  return "Đã xảy ra lỗi. Vui lòng thử lại.";
};

/** The API's own message for a failed request (e.g. which record a 404 is about); empty for a non-API failure. */
export const apiErrorMessage = (error: unknown): string => (error instanceof ApiError ? apiMessages(error).join("; ") : "");

/**
 * Splits a 400 response into messages for known form fields (each validation
 * message starts with the field name) and the rest. Other failures are general.
 */
export const apiFieldErrors = (
  error: unknown,
  fields: readonly string[],
): { fieldErrors: Record<string, string[]>; otherErrors: string[] } => {
  const fieldErrors: Record<string, string[]> = {};
  const otherErrors: string[] = [];

  if (!(error instanceof ApiError) || error.status !== 400 || error.sessionRenewed) {
    return { fieldErrors, otherErrors: [describeApiError(error)] };
  }

  for (const text of apiMessages(error)) {
    const field = text.split(/\s/, 1)[0];
    if (fields.includes(field)) {
      fieldErrors[field] = [...(fieldErrors[field] ?? []), text];
    } else {
      otherErrors.push(text);
    }
  }

  return { fieldErrors, otherErrors };
};

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
