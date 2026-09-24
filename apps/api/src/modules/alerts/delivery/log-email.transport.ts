import { Logger } from '@nestjs/common';
import type { EmailTransport, OutgoingEmail } from './email-transport';

/**
 * Non-production diagnostic transport (CFG-007): logs only the recipient's
 * domain and the subject, never the address or the body. Startup rejects it
 * in production (configuration.ts).
 */
export class LogEmailTransport implements EmailTransport {
  readonly provider = 'log' as const;
  private readonly logger = new Logger(LogEmailTransport.name);
  private sequence = 0;

  send(message: OutgoingEmail) {
    const domain = message.to.split('@')[1] ?? 'unknown';
    this.sequence += 1;
    this.logger.log(
      `Email (log transport) to a recipient at ${domain}: "${message.subject}"`,
    );
    return Promise.resolve({ messageId: `log-${this.sequence}` });
  }
}
