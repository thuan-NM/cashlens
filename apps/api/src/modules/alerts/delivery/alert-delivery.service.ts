import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Alert, AlertDelivery, AlertType, Prisma } from '@prisma/client';
import { AlertDeliveryRepository } from './alert-delivery.repository';
import { DeliveryTimer } from './delivery-timer';
import {
  EMAIL_TRANSPORT,
  EmailSendError,
  EmailTransport,
  OutgoingEmail,
} from './email-transport';

export const DELIVERY_OPTIONS = Symbol('DELIVERY_OPTIONS');

export type DeliveryOptions = {
  attemptTimeoutMs: number;
  totalBudgetMs: number;
  appPublicUrl?: string;
};

export type DeliveryPreferences = {
  /** The alert type's `emailEnabled` setting. */
  emailEnabled: boolean;
  /** `UserSettings.notificationEnabled`. */
  notificationEnabled: boolean;
};

export type SkipReason =
  | 'NOT_CRITICAL'
  | 'EMAIL_DISABLED'
  | 'NOTIFICATIONS_DISABLED'
  | 'TRANSPORT_DISABLED';

/** At most three attempts (ALERT-006); backoff before attempts 2 and 3. */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [500, 1000];
/** A PENDING row this much past the budget was interrupted (data-model). */
export const INTERRUPTED_MARGIN_MS = 30_000;

const TYPE_LABELS: Record<AlertType, string> = {
  BUDGET_THRESHOLD: 'Budget threshold',
  LARGE_TRANSACTION: 'Large transaction',
  CATEGORY_SHIFT: 'Category change',
  GOAL_RISK: 'Goal risk',
  CASHFLOW_RISK: 'Cashflow risk',
  PARSER_ISSUE: 'Parser issue',
  SYSTEM: 'Email connection',
};

/**
 * The email outcome of evaluator-created alerts (ALERT-005–ALERT-007).
 *
 * - `plan` runs inside the evaluation transaction and writes the alert's one
 *   delivery row: SKIPPED with the first applicable reason (no transport,
 *   not CRITICAL, email off for the type, notifications off), or PENDING.
 *   Legacy and user-authored (null-key) alerts get none.
 * - `deliver` runs after that transaction commits: at most three attempts,
 *   each persisted before it is made, bounded per attempt and in total, with
 *   500 ms then 1000 ms backoff. Timeouts, connection errors, and temporary
 *   (4xx) failures are retried; rejections (5xx) and authentication failures
 *   are not. It never throws, and no network call runs inside a transaction.
 * - `sweepInterrupted` marks a PENDING row that outlived the budget plus a
 *   margin as FAILED/INTERRUPTED; it is never resent.
 * - The message names only the alert type and links to the app.
 */
@Injectable()
export class AlertDeliveryService {
  private readonly logger = new Logger(AlertDeliveryService.name);

  constructor(
    private readonly repository: AlertDeliveryRepository,
    @Inject(DELIVERY_OPTIONS) private readonly options: DeliveryOptions,
    private readonly timer: DeliveryTimer,
    @Optional()
    @Inject(EMAIL_TRANSPORT)
    private readonly transport: EmailTransport | null = null,
  ) {}

  /** CFG-007: whether this deployment can send email at all. */
  get available() {
    return this.transport !== null;
  }

  async plan(
    tx: Prisma.TransactionClient,
    alert: Pick<Alert, 'id' | 'userId' | 'type' | 'severity' | 'conditionKey'>,
    preferences: DeliveryPreferences,
  ): Promise<AlertDelivery | null> {
    if (alert.conditionKey === null) return null; // in-app only (ALERT-011)
    const skipReason = this.skipReason(alert, preferences);
    return this.repository.create(tx, {
      alertId: alert.id,
      userId: alert.userId,
      channel: 'EMAIL',
      provider: this.transport?.provider ?? 'none',
      status: skipReason ? 'SKIPPED' : 'PENDING',
      skipReason,
      attemptCount: 0,
      createdAt: this.repository.now(),
    });
  }

  async deliver(deliveryId: string): Promise<void> {
    try {
      await this.attemptAll(deliveryId);
    } catch (error) {
      // The alert stands whatever happens to its email (ALERT-006).
      this.logger.warn(
        `Delivery ${deliveryId} stopped on an unexpected ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }

  async sweepInterrupted(userId: string): Promise<number> {
    const cutoff = new Date(
      this.repository.now().getTime() -
        this.options.totalBudgetMs -
        INTERRUPTED_MARGIN_MS,
    );
    return this.repository.sweepInterrupted(userId, cutoff);
  }

  private skipReason(
    alert: Pick<Alert, 'severity'>,
    preferences: DeliveryPreferences,
  ): SkipReason | null {
    // With email disabled for the deployment every delivery is recorded
    // TRANSPORT_DISABLED (CFG-007, research.md); otherwise the first failing
    // eligibility rule of ALERT-005, in its order.
    if (!this.transport) return 'TRANSPORT_DISABLED';
    if (alert.severity !== 'CRITICAL') return 'NOT_CRITICAL';
    if (!preferences.emailEnabled) return 'EMAIL_DISABLED';
    if (!preferences.notificationEnabled) return 'NOTIFICATIONS_DISABLED';
    return null;
  }

  private async attemptAll(deliveryId: string) {
    const delivery = await this.repository.findForSend(deliveryId);
    if (!delivery || delivery.status !== 'PENDING' || !this.transport) return;
    const transport = this.transport;
    const message = this.message(delivery.recipient, delivery.alert.type);
    const started = this.timer.now();
    const remaining = () =>
      this.options.totalBudgetMs - (this.timer.now() - started);

    let lastError: EmailSendError | null = null;
    for (
      let attempt = delivery.attemptCount + 1;
      attempt <= MAX_ATTEMPTS;
      attempt++
    ) {
      if (lastError) {
        const backoff =
          BACKOFF_MS[Math.min(attempt - 2, BACKOFF_MS.length - 1)];
        if (remaining() - backoff <= 0) break;
        await this.timer.sleep(backoff);
      }
      const budget = Math.min(this.options.attemptTimeoutMs, remaining());
      if (budget <= 0) break;
      if (
        !(await this.repository.recordAttempt(
          delivery.id,
          attempt,
          this.repository.now(),
        ))
      ) {
        return; // another writer owns this delivery
      }
      try {
        await withTimeout(transport.send(message), budget);
        await this.repository.markSent(delivery.id, this.repository.now());
        return;
      } catch (error) {
        lastError =
          error instanceof EmailSendError
            ? error
            : new EmailSendError('CONNECTION');
        if (!lastError.retryable) break;
      }
    }
    const failure = lastError ?? new EmailSendError('TIMEOUT');
    await this.repository.markFailed(
      delivery.id,
      failure.code,
      failure.message,
    );
  }

  private message(to: string, type: AlertType): OutgoingEmail {
    const base = this.options.appPublicUrl?.replace(/\/+$/, '');
    const link = base ? `${base}/app/alerts` : 'the Alerts page of CashLens';
    return {
      to,
      subject: 'CashLens: new critical alert',
      text: [
        `You have a new critical CashLens alert: ${TYPE_LABELS[type]}.`,
        '',
        `Open ${link} to see it.`,
      ].join('\n'),
    };
  }
}

/** Rejects with TIMEOUT when `promise` does not settle within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EmailSendError('TIMEOUT')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
