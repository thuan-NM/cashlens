/**
 * The email port (research.md "Email delivery adapter"). One implementation
 * is bound by `EMAIL_TRANSPORT`: `smtp` (nodemailer) or `log` (redacted,
 * non-production). `disabled` binds none (null), and every delivery is
 * recorded SKIPPED/TRANSPORT_DISABLED. Tests bind an in-memory fake.
 */

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

export type EmailProviderName = 'smtp' | 'log';

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailTransport {
  readonly provider: EmailProviderName;
  /** Resolves when the provider accepted the message; rejects with `EmailSendError`. */
  send(message: OutgoingEmail): Promise<{ messageId: string }>;
}

/**
 * Sanitized failure classes. Timeouts, connection errors, and temporary
 * (SMTP 4xx) failures are retried; a rejection (SMTP 5xx) or an
 * authentication failure is not.
 */
export type EmailFailureCode =
  | 'TIMEOUT'
  | 'CONNECTION'
  | 'TEMPORARY'
  | 'REJECTED'
  | 'AUTH';

const RETRYABLE: EmailFailureCode[] = ['TIMEOUT', 'CONNECTION', 'TEMPORARY'];

const MESSAGES: Record<EmailFailureCode, string> = {
  TIMEOUT: 'The email provider did not answer in time',
  CONNECTION: 'The email provider could not be reached',
  TEMPORARY: 'The email provider deferred the message',
  REJECTED: 'The email provider rejected the message',
  AUTH: 'The email provider refused the credentials',
};

/** Carries a code and a fixed message only: never provider text or addresses. */
export class EmailSendError extends Error {
  constructor(readonly code: EmailFailureCode) {
    super(MESSAGES[code]);
    this.name = 'EmailSendError';
  }

  get retryable() {
    return RETRYABLE.includes(this.code);
  }
}
