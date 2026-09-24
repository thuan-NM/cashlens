export type AlertSeverity = "critical" | "warning" | "info";

/** The lifecycle status (ALERT-010); independent of the read state. */
export type AlertStatus = "ACTIVE" | "DISMISSED" | "RESOLVED";

export type AlertDeliveryStatus = "PENDING" | "SENT" | "SKIPPED" | "FAILED";

/** The alert's single email outcome; null for user-authored and legacy alerts. */
export interface AlertEmailDelivery {
  status: AlertDeliveryStatus;
  skipReason: string | null;
  attemptCount: number;
  failureCode: string | null;
  sentAt: string | null;
}

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

/** An alert as the API returns it (`GET /alerts`). */
export interface ApiAlert {
  id: string;
  type: string;
  severity?: string;
  title: string;
  message: string;
  isRead?: boolean;
  status?: AlertStatus;
  conditionKey?: string | null;
  triggeredAt?: string;
  createdAt?: string;
  dismissedAt?: string | null;
  resolvedAt?: string | null;
  resolutionReason?: string | null;
  emailDelivery?: (AlertEmailDelivery & { channel?: string }) | null;
}

/** A per-type alert setting as the API returns it. */
export interface ApiAlertSetting {
  type: string;
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  threshold?: number | string | null;
  emailAvailable?: boolean;
}

/** A per-type alert preference (`GET /alerts/settings`). */
export interface AlertSetting {
  type: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  threshold: number | null;
  /** false when the deployment runs with email delivery disabled (CFG-007). */
  emailAvailable: boolean;
}
