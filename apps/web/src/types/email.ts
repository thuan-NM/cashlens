/** An email listen rule as the API returns it (`GET /email-listen-rules`). */
export interface ApiEmailListenRule {
  id: string;
  name: string;
  emailConnectionId?: string | null;
  bankProviderId?: string | null;
  senderEmail?: string | null;
  senderDomain?: string | null;
  isEnabled?: boolean;
  priority?: number;
  lastMatchedAt?: string | null;
  /** Not returned by the current API; the rule badge falls back to "API". */
  bank?: string | null;
}

/** A stored email message as the API returns it (`GET /email-messages`). */
export interface ApiEmailMessage {
  id: string;
  senderEmail?: string;
  subject?: string | null;
  receivedAt?: string;
  processingStatus?: string;
}
