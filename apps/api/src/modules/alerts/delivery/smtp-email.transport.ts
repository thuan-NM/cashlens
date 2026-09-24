import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpConfig } from '../../../config/configuration';
import {
  EmailFailureCode,
  EmailSendError,
  EmailTransport,
  OutgoingEmail,
} from './email-transport';

/**
 * SMTP through nodemailer (research.md "Email delivery adapter"). Implicit
 * TLS when `SMTP_SECURE=true`, otherwise STARTTLS is required. Provider
 * errors are reduced to a failure class; their text, which can echo
 * addresses or credentials, is never kept.
 */
export class SmtpEmailTransport implements EmailTransport {
  readonly provider = 'smtp' as const;
  private readonly logger = new Logger(SmtpEmailTransport.name);
  private readonly transporter: Transporter;

  constructor(
    smtp: SmtpConfig,
    private readonly from: string,
    attemptTimeoutMs: number,
  ) {
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
      connectionTimeout: attemptTimeoutMs,
      greetingTimeout: attemptTimeoutMs,
      socketTimeout: attemptTimeoutMs,
    });
  }

  async send(message: OutgoingEmail) {
    try {
      const info = (await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      })) as { messageId?: string };
      return { messageId: info.messageId ?? '' };
    } catch (error) {
      const code = classifySmtpError(error);
      this.logger.warn(`SMTP delivery attempt failed (${code})`);
      throw new EmailSendError(code);
    }
  }
}

/** nodemailer error → failure class (4xx and network: retried). */
export function classifySmtpError(error: unknown): EmailFailureCode {
  const detail = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  const code = typeof detail.code === 'string' ? detail.code : '';
  const responseCode =
    typeof detail.responseCode === 'number' ? detail.responseCode : 0;
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 530) {
    return 'AUTH';
  }
  if (responseCode >= 500) return 'REJECTED';
  if (responseCode >= 400) return 'TEMPORARY';
  if (code === 'ETIMEDOUT') return 'TIMEOUT';
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return 'REJECTED';
  return 'CONNECTION';
}
