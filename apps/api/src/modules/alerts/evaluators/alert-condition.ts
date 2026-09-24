import type { AlertSeverity, AlertType, Prisma } from '@prisma/client';

/**
 * One evaluated condition (research.md "Alert trigger semantics"): what an
 * evaluator returns and the lifecycle applies (ALERT-003). Evaluators are
 * pure; they never read or write the database.
 *
 * - `key` is the stable condition identity (data-model "Condition key
 *   formats"): ASCII, no sensitive values, one per severity tier.
 * - `holds` false resolves an open occurrence with `resolutionReason`.
 * - `mayCreate` false is a matrix creation limit (a past budget period, a
 *   transaction outside the current month): the condition can still resolve
 *   an open occurrence but never opens one.
 * - `threshold`, `observed`, and `window` are the ALERT-001 evidence. Title,
 *   message, and metadata are the sanitized in-app explanation; they are
 *   never put in an email (ALERT-007).
 */
export type AlertWindow = { start: Date; end: Date };

export type AlertTarget = { resourceType: string; resourceId: string };

export type AlertCondition = {
  key: string;
  holds: boolean;
  type: AlertType;
  severity: AlertSeverity;
  target: AlertTarget;
  threshold: Prisma.Decimal | null;
  observed: Prisma.Decimal | null;
  window: AlertWindow | null;
  mayCreate: boolean;
  /** Why an open occurrence resolves when `holds` is false. */
  resolutionReason: AlertResolutionReason;
  title: string;
  message: string;
  metadata: Record<string, string | number | boolean | null>;
};

/** Stored in `Alert.resolutionReason` (data-model "Alert condition lifecycle"). */
export type AlertResolutionReason =
  | 'BELOW_THRESHOLD'
  | 'PERIOD_ENDED'
  | 'TARGET_REMOVED'
  | 'INSUFFICIENT_DATA'
  | 'CONDITION_CLEARED'
  | 'RECONNECTED'
  | 'DISCONNECTED'
  | 'SYNC_SUCCEEDED';

/** A new occurrence may open only this long after the last one (ALERT-003). */
export const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
