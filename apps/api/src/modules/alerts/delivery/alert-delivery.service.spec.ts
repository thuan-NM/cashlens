import type {
  AlertDelivery,
  AlertSeverity,
  AlertType,
  Prisma,
} from '@prisma/client';
import { InMemoryEmailTransport } from '../../../../test/fakes/in-memory-email-transport';
import type { AlertDeliveryRepository } from './alert-delivery.repository';
import {
  AlertDeliveryService,
  DeliveryOptions,
} from './alert-delivery.service';

/**
 * ALERT-005–ALERT-007, CFG-007 (T077). No network: the transport is the
 * in-memory fake, time is a fake timer that advances only when told (a
 * backoff sleep advances it), and wall-clock stamps come from a fixed clock.
 */

const T0 = new Date('2026-09-23T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const OPTIONS: DeliveryOptions = {
  attemptTimeoutMs: 5000,
  totalBudgetMs: 12000,
  appPublicUrl: 'https://cashlens.example.test',
};

class FakeTimer {
  elapsed = 0;
  sleeps: number[] = [];
  now() {
    return this.elapsed;
  }
  sleep(ms: number) {
    this.sleeps.push(ms);
    this.elapsed += ms;
    return Promise.resolve();
  }
}

type Row = AlertDelivery & { alertType: AlertType; recipient: string };

class FakeDeliveryRepository {
  rows = new Map<string, Row>();
  wallClock = T0;
  alertTypes = new Map<string, AlertType>();

  create(_tx: unknown, data: Prisma.AlertDeliveryUncheckedCreateInput) {
    const row: Row = {
      id: `d-${this.rows.size + 1}`,
      alertId: data.alertId,
      userId: data.userId,
      channel: data.channel ?? 'EMAIL',
      provider: data.provider,
      status: data.status,
      skipReason: data.skipReason ?? null,
      attemptCount: data.attemptCount ?? 0,
      lastAttemptAt: null,
      sentAt: null,
      failureCode: null,
      failureMessage: null,
      createdAt: (data.createdAt as Date) ?? this.wallClock,
      updatedAt: this.wallClock,
      alertType: this.alertTypes.get(data.alertId) ?? 'BUDGET_THRESHOLD',
      recipient: 'owner@example.test',
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  findForSend(id: string) {
    const row = this.rows.get(id);
    return Promise.resolve(
      row
        ? {
            id: row.id,
            status: row.status,
            attemptCount: row.attemptCount,
            alert: { id: row.alertId, type: row.alertType },
            recipient: row.recipient,
          }
        : null,
    );
  }

  recordAttempt(id: string, attempt: number, at: Date) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'PENDING' || row.attemptCount !== attempt - 1) {
      return Promise.resolve(false);
    }
    if (attempt > 3) throw new Error('CHECK attemptCount BETWEEN 0 AND 3');
    row.attemptCount = attempt;
    row.lastAttemptAt = at;
    return Promise.resolve(true);
  }

  markSent(id: string, at: Date) {
    const row = this.rows.get(id)!;
    if (row.status === 'PENDING')
      Object.assign(row, { status: 'SENT', sentAt: at });
    return Promise.resolve();
  }

  markFailed(id: string, code: string, message: string) {
    const row = this.rows.get(id)!;
    if (row.status === 'PENDING') {
      Object.assign(row, {
        status: 'FAILED',
        failureCode: code,
        failureMessage: message,
      });
    }
    return Promise.resolve();
  }

  sweepInterrupted(userId: string, cutoff: Date) {
    let count = 0;
    for (const row of this.rows.values()) {
      const since = row.lastAttemptAt ?? row.createdAt;
      if (row.userId === userId && row.status === 'PENDING' && since < cutoff) {
        Object.assign(row, {
          status: 'FAILED',
          failureCode: 'INTERRUPTED',
          failureMessage: 'The delivery was interrupted and was not resent',
        });
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  now() {
    return this.wallClock;
  }
}

const alert = (
  overrides: Partial<{
    id: string;
    severity: AlertSeverity;
    type: AlertType;
    conditionKey: string | null;
  }> = {},
) => ({
  id: 'a1',
  userId: 'u1',
  type: 'BUDGET_THRESHOLD' as AlertType,
  severity: 'CRITICAL' as AlertSeverity,
  conditionKey: 'budget:b1:2026-09-01:CRITICAL',
  ...overrides,
});

const OPTED_IN = { emailEnabled: true, notificationEnabled: true };

describe('AlertDeliveryService (T077)', () => {
  let repository: FakeDeliveryRepository;
  let timer: FakeTimer;
  let transport: InMemoryEmailTransport;

  const service = (
    withTransport: InMemoryEmailTransport | null = transport,
    options: DeliveryOptions = OPTIONS,
  ) =>
    new AlertDeliveryService(
      repository as unknown as AlertDeliveryRepository,
      options,
      timer,
      withTransport,
    );

  const planAndDeliver = async (
    subject = service(),
    target = alert(),
    preferences = OPTED_IN,
  ) => {
    const planned = await subject.plan(TX, target, preferences);
    if (planned?.status === 'PENDING') await subject.deliver(planned.id);
    return planned ? repository.rows.get(planned.id)! : null;
  };

  beforeEach(() => {
    repository = new FakeDeliveryRepository();
    timer = new FakeTimer();
    transport = new InMemoryEmailTransport();
  });

  describe('eligibility: exactly one outcome row per evaluator-created alert', () => {
    it('skips a non-critical alert with NOT_CRITICAL', async () => {
      const row = await planAndDeliver(
        service(),
        alert({ severity: 'WARNING' }),
      );
      expect(row).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'NOT_CRITICAL',
        attemptCount: 0,
        provider: 'smtp',
      });
      expect(transport.attempts).toBe(0);
    });

    it('skips when email is off for the type with EMAIL_DISABLED', async () => {
      const row = await planAndDeliver(service(), alert(), {
        emailEnabled: false,
        notificationEnabled: true,
      });
      expect(row).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'EMAIL_DISABLED',
      });
      expect(transport.attempts).toBe(0);
    });

    it('skips when the user turned notifications off with NOTIFICATIONS_DISABLED', async () => {
      const row = await planAndDeliver(service(), alert(), {
        emailEnabled: true,
        notificationEnabled: false,
      });
      expect(row).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'NOTIFICATIONS_DISABLED',
      });
    });

    it('skips when the deployment has no transport with TRANSPORT_DISABLED', async () => {
      const row = await planAndDeliver(service(null));
      expect(row).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'TRANSPORT_DISABLED',
        provider: 'none',
      });
    });

    it('applies the reasons in a fixed order: transport, severity, type opt-in, notifications', async () => {
      const none = { emailEnabled: false, notificationEnabled: false };
      const first = await planAndDeliver(
        service(null),
        alert({ severity: 'WARNING' }),
        none,
      );
      expect(first?.skipReason).toBe('TRANSPORT_DISABLED');
      const row = await planAndDeliver(
        service(),
        alert({ id: 'a1b', severity: 'WARNING' }),
        none,
      );
      expect(row?.skipReason).toBe('NOT_CRITICAL');
      const second = await planAndDeliver(service(), alert({ id: 'a2' }), none);
      expect(second?.skipReason).toBe('EMAIL_DISABLED');
      const third = await planAndDeliver(service(), alert({ id: 'a3' }), {
        emailEnabled: true,
        notificationEnabled: false,
      });
      expect(third?.skipReason).toBe('NOTIFICATIONS_DISABLED');
      expect(transport.attempts).toBe(0);
    });

    it('records every evaluator alert as TRANSPORT_DISABLED when email is disabled, even a WARNING (CFG-007)', async () => {
      const row = await planAndDeliver(
        service(null),
        alert({ severity: 'WARNING' }),
        OPTED_IN,
      );
      expect(row).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'TRANSPORT_DISABLED',
        provider: 'none',
      });
    });

    it('creates no delivery row for a legacy or user-authored (null-key) alert', async () => {
      const planned = await service().plan(
        TX,
        alert({ conditionKey: null }),
        OPTED_IN,
      );
      expect(planned).toBeNull();
      expect(repository.rows.size).toBe(0);
    });

    it('stamps the row with the injected clock', async () => {
      const row = await planAndDeliver(
        service(),
        alert({ severity: 'WARNING' }),
      );
      expect(row?.createdAt).toEqual(T0);
    });
  });

  describe('bounded attempts', () => {
    it('sends on the first attempt', async () => {
      const row = await planAndDeliver();
      expect(row).toMatchObject({
        status: 'SENT',
        attemptCount: 1,
        sentAt: T0,
        lastAttemptAt: T0,
        failureCode: null,
      });
      expect(transport.sent).toHaveLength(1);
      expect(timer.sleeps).toEqual([]);
    });

    it('sends on the second attempt after a temporary (4xx) failure, backing off 500 ms', async () => {
      transport.script = ['TEMPORARY'];
      const row = await planAndDeliver();
      expect(row).toMatchObject({ status: 'SENT', attemptCount: 2 });
      expect(timer.sleeps).toEqual([500]);
    });

    it('sends on the third attempt after a timeout and a connection error, backing off 500 then 1000 ms', async () => {
      transport.script = ['TIMEOUT', 'CONNECTION'];
      const row = await planAndDeliver();
      expect(row).toMatchObject({ status: 'SENT', attemptCount: 3 });
      expect(timer.sleeps).toEqual([500, 1000]);
      expect(transport.sent).toHaveLength(1);
    });

    it('fails after three retried failures, never a fourth attempt', async () => {
      transport.script = ['TEMPORARY', 'TEMPORARY', 'TEMPORARY', 'ok'];
      const row = await planAndDeliver();
      expect(row).toMatchObject({
        status: 'FAILED',
        attemptCount: 3,
        failureCode: 'TEMPORARY',
        sentAt: null,
      });
      expect(transport.attempts).toBe(3);
      expect(transport.sent).toHaveLength(0);
    });

    it.each(['REJECTED', 'AUTH'] as const)(
      'does not retry a %s failure',
      async (code) => {
        transport.script = [code];
        const row = await planAndDeliver();
        expect(row).toMatchObject({
          status: 'FAILED',
          attemptCount: 1,
          failureCode: code,
        });
        expect(transport.attempts).toBe(1);
        expect(timer.sleeps).toEqual([]);
      },
    );

    it('times out an attempt that never answers, and retries it', async () => {
      transport.script = ['hang', 'ok'];
      const row = await planAndDeliver(
        service(transport, {
          ...OPTIONS,
          attemptTimeoutMs: 20,
          totalBudgetMs: 5000,
        }),
      );
      expect(row).toMatchObject({ status: 'SENT', attemptCount: 2 });
    });

    it('stops when the total time budget is exhausted', async () => {
      // Each attempt takes 6 s: after two attempts and one backoff (12.5 s)
      // the 12 s budget is spent, so there is no third attempt.
      transport.onAttempt = () => {
        timer.elapsed += 6000;
      };
      transport.script = ['TIMEOUT', 'TIMEOUT', 'ok'];
      const row = await planAndDeliver();
      expect(row).toMatchObject({
        status: 'FAILED',
        attemptCount: 2,
        failureCode: 'TIMEOUT',
      });
      expect(transport.attempts).toBe(2);
    });

    it('never throws, even when the repository fails', async () => {
      const subject = service();
      const planned = await subject.plan(TX, alert(), OPTED_IN);
      repository.findForSend = () => Promise.reject(new Error('database down'));
      await expect(subject.deliver(planned!.id)).resolves.toBeUndefined();
    });

    it('does nothing for a delivery that is not PENDING', async () => {
      const subject = service();
      const planned = await subject.plan(TX, alert(), OPTED_IN);
      await subject.deliver(planned!.id);
      await subject.deliver(planned!.id);
      expect(transport.attempts).toBe(1);
    });
  });

  describe('interrupted delivery', () => {
    it('turns a stale PENDING row into FAILED/INTERRUPTED and never resends it', async () => {
      const subject = service();
      const planned = await subject.plan(TX, alert(), OPTED_IN);
      // The process stopped after persisting attempt 1.
      await repository.recordAttempt(planned!.id, 1, T0);

      repository.wallClock = new Date(T0.getTime() + 12_000 + 30_000 - 1);
      expect(await subject.sweepInterrupted('u1')).toBe(0);

      repository.wallClock = new Date(T0.getTime() + 12_000 + 30_000 + 1);
      expect(await subject.sweepInterrupted('u1')).toBe(1);
      expect(repository.rows.get(planned!.id)).toMatchObject({
        status: 'FAILED',
        failureCode: 'INTERRUPTED',
        attemptCount: 1,
      });

      await subject.deliver(planned!.id);
      expect(transport.attempts).toBe(0);
    });

    it('measures from creation when no attempt was recorded', async () => {
      const subject = service();
      await subject.plan(TX, alert(), OPTED_IN);
      repository.wallClock = new Date(T0.getTime() + 43_000);
      expect(await subject.sweepInterrupted('u1')).toBe(1);
    });

    it("leaves other users' deliveries alone", async () => {
      const subject = service();
      await subject.plan(TX, alert(), OPTED_IN);
      repository.wallClock = new Date(T0.getTime() + 60_000);
      expect(await subject.sweepInterrupted('someone-else')).toBe(0);
    });
  });

  describe('privacy (ALERT-007)', () => {
    it('states only that a critical alert of a named type exists, with an app link', async () => {
      repository.alertTypes.set('a1', 'CASHFLOW_RISK');
      await planAndDeliver(service(), alert({ type: 'CASHFLOW_RISK' }));
      const [message] = transport.sent;
      expect(message.to).toBe('owner@example.test');
      expect(message.subject).toBe('CashLens: new critical alert');
      expect(message.text).toContain(
        'https://cashlens.example.test/app/alerts',
      );
    });

    it.each([
      ['BUDGET_THRESHOLD', 'Budget threshold'],
      ['CASHFLOW_RISK', 'Cashflow risk'],
      ['SYSTEM', 'Email connection'],
    ] as [AlertType, string][])(
      'names the %s type as "%s"',
      async (type, label) => {
        repository.alertTypes.set('a1', type);
        await planAndDeliver(service(), alert({ type }));
        expect(transport.sent[0].text).toContain(label);
      },
    );

    it('never carries amounts, merchants, categories, accounts, tokens, or alert text', async () => {
      await planAndDeliver();
      const [message] = transport.sent;
      const body = `${message.subject}\n${message.text}`;
      expect(body).not.toMatch(/\d{3,}/); // no amounts or ids
      for (const forbidden of [
        'budget:',
        'b1',
        'a1',
        'VND',
        'merchant',
        'category',
        'account',
        'token',
        'password',
      ]) {
        expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });
  });
});
