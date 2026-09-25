import type {
  Alert as ContractAlert,
  AlertDelivery,
  AlertDeliveryStatus as ContractAlertDeliveryStatus,
  AlertSetting as ContractAlertSetting,
  AlertStatus as ContractAlertStatus,
} from "@repo/api-contract";

export type AlertSeverity = "critical" | "warning" | "info";

/** The lifecycle status (ALERT-010); independent of the read state. */
export type AlertStatus = ContractAlertStatus;

export type AlertDeliveryStatus = ContractAlertDeliveryStatus;

/** The alert's single email outcome; null for user-authored and legacy alerts. */
export type AlertEmailDelivery = Pick<AlertDelivery, "status" | "skipReason" | "attemptCount" | "failureCode" | "sentAt">;

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  typeLabel: string;
  title: string;
  desc: string;
  time: string;
  status: AlertStatus;
  isRead: boolean;
  /** null: a user-authored or pre-release alert, never evaluated. */
  conditionKey: string | null;
  dismissedAt: string | null;
  resolvedAt: string | null;
  resolutionReason: string | null;
  emailDelivery: AlertEmailDelivery | null;
}

/** An alert as the API returns it (`GET /alerts`): the API contract's `Alert`. */
export type ApiAlert = ContractAlert;

/** A per-type alert setting as the API returns it: the API contract's `AlertSetting`. */
export type ApiAlertSetting = ContractAlertSetting;

/** A per-type alert preference (`GET /alerts/settings`). */
export interface AlertSetting {
  type: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  threshold: number | null;
  /** false when the deployment runs with email delivery disabled (CFG-007). */
  emailAvailable: boolean;
}
