import { ApiError } from "@/api/client";
import { describeApiError } from "@/api/mappers";

/** The API's EmailSyncRun (contracts/openapi.yaml). */
export interface SyncRun {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL_FAILED" | "FAILED" | "EXPIRED";
  startedAt: string;
  finishedAt: string | null;
  emailsFound: number;
  emailsMatched: number;
  emailsParsed: number;
  emailsFailed: number;
  transactionsCreated: number;
  hasMore: boolean;
  errorMessage: string | null;
}

/** The API's email connection view, including recovery state (EMAIL-003). */
export interface EmailConnection {
  id: string;
  provider: string;
  emailAddress: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "ERROR";
  lastSyncedAt: string | null;
  lastFailedAt: string | null;
  errorMessage: string | null;
  reconnectRequired: boolean;
  recoveryAction: "NONE" | "RETRY" | "RECONNECT" | "CONNECT";
  backfillFrom: string | null;
  backfillCompletedAt: string | null;
  syncInProgress: boolean;
}

export type Tone = "success" | "info" | "warning" | "error";

/** Hex, as `Badge` derives its tint by appending an alpha to the colour. */
export const TONE_COLORS: Record<Tone, string> = {
  success: "#4a9d6e",
  info: "#d97757",
  warning: "#d99a3c",
  error: "#d2604c",
};

export const RUN_STATUS: Record<SyncRun["status"], { label: string; tone: Tone }> = {
  RUNNING: { label: "Đang chạy", tone: "info" },
  SUCCESS: { label: "Thành công", tone: "success" },
  PARTIAL_FAILED: { label: "Thành công một phần", tone: "warning" },
  FAILED: { label: "Thất bại", tone: "error" },
  EXPIRED: { label: "Bị gián đoạn", tone: "error" },
};

/** Counts found/matched/parsed/created/failed of one run (EMAIL-005). */
export const runCounts = (run: SyncRun) =>
  `${run.emailsFound} email · khớp ${run.emailsMatched} · bóc tách ${run.emailsParsed} · ${run.transactionsCreated} giao dịch mới · ${run.emailsFailed} lỗi`;

/** What the page says after a sync attempt, and which action it offers next. */
export type SyncOutcome = {
  tone: Tone;
  title: string;
  detail?: string;
  action?: "CONTINUE" | "RETRY" | "RECONNECT";
};

export function outcomeOfRun(run: SyncRun): SyncOutcome {
  const detail = [runCounts(run), run.errorMessage].filter(Boolean).join(". ");
  if (run.status === "FAILED" || run.status === "EXPIRED") {
    return { tone: "error", title: "Đồng bộ không thành công", detail, action: "RETRY" };
  }
  if (run.hasMore) {
    return {
      tone: run.status === "PARTIAL_FAILED" ? "warning" : "info",
      title: "Đã xử lý một phần: vẫn còn email chưa đồng bộ",
      detail,
      action: "CONTINUE",
    };
  }
  if (run.status === "PARTIAL_FAILED") {
    return { tone: "warning", title: "Đồng bộ xong, có email không xử lý được", detail };
  }
  return { tone: "success", title: "Đồng bộ xong", detail };
}

const errorCode = (error: unknown) =>
  error instanceof ApiError ? (error.body as { code?: unknown } | null)?.code : undefined;

/** A refused sync request: conflict (409), reconnect (503), or another failure. */
export function outcomeOfError(error: unknown): SyncOutcome {
  if (error instanceof ApiError && error.status === 409) {
    return {
      tone: "info",
      title: "Một lượt đồng bộ khác đang chạy",
      detail: "Đợi lượt đó hoàn tất rồi thử lại.",
      action: "RETRY",
    };
  }
  if (errorCode(error) === "RECONNECT_REQUIRED") {
    return {
      tone: "warning",
      title: "Cần kết nối lại Gmail",
      detail: "Quyền truy cập Gmail đã hết hạn hoặc bị thu hồi.",
      action: "RECONNECT",
    };
  }
  if (error instanceof ApiError && error.status === 503) {
    return {
      tone: "warning",
      title: "Gmail tạm thời không khả dụng",
      detail: "Vui lòng thử lại sau ít phút.",
      action: "RETRY",
    };
  }
  return { tone: "error", title: "Không thể đồng bộ", detail: describeApiError(error), action: "RETRY" };
}

/** The connection's health line and its recovery action (EMAIL-003). */
export function connectionState(connection: EmailConnection): {
  tone: Tone;
  label: string;
  action: "SYNC" | "RETRY" | "RECONNECT" | "CONNECT";
} {
  if (connection.syncInProgress) return { tone: "info", label: "Đang đồng bộ", action: "SYNC" };
  switch (connection.recoveryAction) {
    case "RECONNECT":
      return { tone: "warning", label: "Cần kết nối lại", action: "RECONNECT" };
    case "CONNECT":
      return { tone: "error", label: "Đã ngắt kết nối", action: "CONNECT" };
    case "RETRY":
      return { tone: "warning", label: "Lần đồng bộ trước thất bại", action: "RETRY" };
    default:
      return { tone: "success", label: "Đang hoạt động", action: "SYNC" };
  }
}
