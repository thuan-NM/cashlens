import type { Transaction as ContractTransaction } from "@repo/api-contract";
import { ApiError } from "@/api/client";
import type { Alert, AlertSetting, AlertStatus, ApiAlert, ApiAlertSetting } from "@/types/alert";
import type { ApiBudget, Budget } from "@/types/budget";
import type { ApiGoal, Goal } from "@/types/goal";
import type { ApiCategory, Category, Transaction } from "@/types/transaction";
import { formatDate, formatDateTime } from "@/utils/format";

/** Labels of the API alert types (`AlertType`). */
export const alertTypeLabels: Record<string, string> = {
  BUDGET_THRESHOLD: "Ngân sách",
  LARGE_TRANSACTION: "Giao dịch lớn",
  CATEGORY_SHIFT: "Biến động danh mục",
  GOAL_RISK: "Rủi ro mục tiêu",
  CASHFLOW_RISK: "Rủi ro dòng tiền",
  PARSER_ISSUE: "Lỗi bóc tách",
  SYSTEM: "Kết nối email",
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

export const mapCategory = (item: ApiCategory): Category => ({
  id: item.id,
  name: item.name,
  type: String(item.type ?? "EXPENSE").toLowerCase() as Category["type"],
  color: item.color ?? "#9c968d",
});

const toDirection = (direction?: string | null): Transaction["dir"] => {
  if (direction === "INCOME") return "income";
  if (direction === "TRANSFER_IN" || direction === "TRANSFER_OUT") return "transfer";
  return "expense";
};

export const mapTransaction = (item: TransactionPayload): Transaction => ({
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
/** A transaction as the API returns it: the API contract's `Transaction`. */
export type TransactionPayload = ContractTransaction;

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
  /** Who decided the current category: MANUAL, USER_RULE, SYSTEM_RULE, FALLBACK, or UNKNOWN. */
  classificationSource: string;
  userNote: string;
  transactionTime: string;
}

/** Why the rules picked a winner (CLASS-003): the ranked matches and the deciding tie-break. */
export type DecisionExplanation = {
  candidates: Array<{ ruleId: string; scope: "USER" | "SYSTEM"; priority: number; createdAt: string; categoryId: string | null }>;
  winnerRuleId: string | null;
  runnerUpRuleId: string | null;
  tieBreak: "SCOPE" | "PRIORITY" | "CREATED_AT" | "ID" | null;
  conflict: boolean;
};

/** One append-only category history event (CLASS-005), oldest first. */
export type CategoryEventPayload = {
  id: string;
  sequence: number;
  createdAt: string;
  source: string;
  trigger: string;
  reason: string;
  actorType: string;
  merchantRuleId: string | null;
  previousCategory: { id: string; name: string | null } | null;
  newCategory: { id: string; name: string | null } | null;
  explanation: DecisionExplanation | null;
};

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
  classificationSource: item.classificationSource ?? "UNKNOWN",
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

export const mapBudget = (item: ApiBudget): Budget => ({
  id: item.id,
  cat: item.categoryId ?? null,
  name: item.name ?? "",
  limit: Number(item.amount ?? 0),
  spent: Number(item.usage?.spent ?? 0),
  percentUsed: Number(item.usage?.percentUsed ?? 0),
  threshold: Number(item.thresholdPercent ?? 80),
  currency: item.currency ?? "VND",
  period: item.period ?? "MONTHLY",
  warningThresholdActive: item.warningThresholdActive !== false,
  alertsSupported: item.alertsSupported !== false,
  usageBasis: item.usageBasis ?? "PERIOD_INSTANCE",
  isNearThreshold: Boolean(item.usage?.isNearThreshold),
  isOverLimit: Boolean(item.usage?.isOverLimit),
});

/** A goal as the list shows it; its deadline is the calendar date in the account time zone (the one the API reads). */
export const mapGoal = (item: ApiGoal, timeZone?: string): Goal => ({
  id: item.id,
  name: item.name,
  type: (item.type ? goalTypeLabels[item.type] : undefined) ?? item.type ?? "Mục tiêu",
  target: Number(item.targetAmount ?? 0),
  saved: Number(item.savedAmount ?? 0),
  date: formatDate(item.targetDate, timeZone) || "-",
  // No fabricated duration: a goal without one uses the API's visible default horizon.
  months: item.months === null || item.months === undefined ? null : Number(item.months),
  priority: item.priority ?? "MEDIUM",
  currency: item.currency ?? "VND",
  remaining: Number(item.remainingAmount ?? 0),
});

const alertSeverity = (severity?: string): Alert["severity"] => {
  if (severity === "CRITICAL") return "critical";
  if (severity === "WARNING") return "warning";
  return "info";
};

export const mapAlert = (item: ApiAlert): Alert => ({
  id: item.id,
  type: item.type,
  severity: alertSeverity(item.severity),
  typeLabel: alertTypeLabels[item.type] ?? String(item.type ?? "SYSTEM").replaceAll("_", " ").toLowerCase(),
  title: item.title,
  desc: item.message,
  time: (() => {
    const when = item.triggeredAt ?? item.createdAt;
    return when ? new Date(when).toLocaleString("vi-VN") : "";
  })(),
  status: (item.status ?? "ACTIVE") as AlertStatus,
  isRead: Boolean(item.isRead),
  conditionKey: item.conditionKey ?? null,
  dismissedAt: item.dismissedAt ?? null,
  resolvedAt: item.resolvedAt ?? null,
  resolutionReason: item.resolutionReason ?? null,
  emailDelivery: item.emailDelivery
    ? {
        status: item.emailDelivery.status,
        skipReason: item.emailDelivery.skipReason ?? null,
        attemptCount: Number(item.emailDelivery.attemptCount ?? 0),
        failureCode: item.emailDelivery.failureCode ?? null,
        sentAt: item.emailDelivery.sentAt ?? null,
      }
    : null,
});

export const mapAlertSetting = (item: ApiAlertSetting): AlertSetting => ({
  type: item.type,
  inAppEnabled: item.inAppEnabled !== false,
  emailEnabled: Boolean(item.emailEnabled),
  threshold: item.threshold === null || item.threshold === undefined ? null : Number(item.threshold),
  emailAvailable: Boolean(item.emailAvailable),
});
