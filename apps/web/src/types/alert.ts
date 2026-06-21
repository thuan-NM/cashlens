export type AlertSeverity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  typeLabel: string;
  title: string;
  desc: string;
  time: string;
}
