/**
 * Alert read and lifecycle changes made on one page (the Alerts page, the
 * notification drawer) are announced so the other refreshes its unread count
 * from the API. The count itself always comes from `GET /alerts/unread-count`.
 */
export const ALERTS_CHANGED_EVENT = "cashlens:alerts-changed";

export const notifyAlertsChanged = () => window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
