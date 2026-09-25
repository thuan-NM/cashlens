/** The account's settings as the API returns them (`GET /auth/me`). */
export interface ApiUserSettings {
  storeRawEmailBody?: boolean;
  rawEmailBodyAvailable?: boolean;
  allowAiInsights?: boolean;
  autoClassificationEnabled?: boolean;
  defaultMonthStartDay?: number;
  dataRetentionDays?: number | null;
  notificationEnabled?: boolean;
  metadata?: Record<string, unknown> | null;
}

/** The signed-in user as the API returns it (`GET /auth/me`, and `user` of the login response). */
export interface ApiUser {
  id: string;
  email: string;
  fullName?: string | null;
  role?: string;
  timezone?: string;
  locale?: string;
  baseCurrency?: string;
  status?: string;
  lastLoginAt?: string | null;
  settings?: ApiUserSettings | null;
  createdAt?: string;
  updatedAt?: string;
}
