import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DELIVERY_OPTIONS, DeliveryOptions } from './alert-delivery.service';
import { EMAIL_TRANSPORT, EmailTransport } from './email-transport';
import { LogEmailTransport } from './log-email.transport';
import { SmtpEmailTransport } from './smtp-email.transport';

/**
 * Binds the transport selected by `EMAIL_TRANSPORT` (CFG-007). The
 * configuration was validated at startup (configuration.ts): SMTP settings
 * are complete when `smtp` is selected, and `log` never runs in production.
 */
export function createEmailTransport(
  config: Pick<ConfigService, 'get'>,
): EmailTransport | null {
  const kind = config.get<string>('EMAIL_TRANSPORT') ?? 'disabled';
  const timeout = Number(
    config.get<string>('EMAIL_ATTEMPT_TIMEOUT_MS') ?? 5000,
  );
  if (kind === 'log') return new LogEmailTransport();
  if (kind !== 'smtp') return null;
  return new SmtpEmailTransport(
    {
      host: config.get<string>('SMTP_HOST') ?? '',
      port: Number(config.get<string>('SMTP_PORT')),
      secure:
        String(config.get<string>('SMTP_SECURE')).trim().toLowerCase() ===
        'true',
      user: config.get<string>('SMTP_USER') ?? '',
      password: config.get<string>('SMTP_PASSWORD') ?? '',
    },
    config.get<string>('EMAIL_FROM') ?? '',
    timeout,
  );
}

export function deliveryOptions(
  config: Pick<ConfigService, 'get'>,
): DeliveryOptions {
  return {
    attemptTimeoutMs: Number(
      config.get<string>('EMAIL_ATTEMPT_TIMEOUT_MS') ?? 5000,
    ),
    totalBudgetMs: Number(config.get<string>('EMAIL_TOTAL_BUDGET_MS') ?? 12000),
    appPublicUrl: config.get<string>('APP_PUBLIC_URL')?.trim() || undefined,
  };
}

export const emailDeliveryProviders: Provider[] = [
  {
    provide: EMAIL_TRANSPORT,
    inject: [ConfigService],
    useFactory: createEmailTransport,
  },
  {
    provide: DELIVERY_OPTIONS,
    inject: [ConfigService],
    useFactory: deliveryOptions,
  },
];
