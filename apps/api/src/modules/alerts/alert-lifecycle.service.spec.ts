import { Alert, AlertStatus, Prisma } from '@prisma/client';
import {
  AlertLifecycleService,
  storableEvidence,
} from './alert-lifecycle.service';
import type { AlertsRepository } from './alerts.repository';
import {
  ALERT_COOLDOWN_MS,
  AlertCondition,
} from './evaluators/alert-condition';

/**
 * ALERT-002, ALERT-003, ALERT-010, ALERT-011 (T066). The fake repository
 * keeps rows in memory and enforces the partial unique index the way
 * PostgreSQL does: one open (ACTIVE or DISMISSED) row per non-null key.
 * Time is always passed in; no test reads the real clock.
 */

const USER = 'user-1';
const T0 = new Date('2026-09-23T03:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const TX = {} as Prisma.TransactionClient;

let sequence = 0;

const row = (overrides: Partial<Alert>): Alert => ({
  id: `alert-${++sequence}`,
  userId: USER,
  type: 'BUDGET_THRESHOLD',
  severity: 'WARNING',
  title: 'title',
  message: 'message',
  resourceType: 'budget',
  resourceId: 'budget-1',
  isRead: false,
  readAt: null,
  metadata: null,
  createdAt: T0,
  status: 'ACTIVE',
  conditionKey: null,
  thresholdValue: null,
  observedValue: null,
  periodStart: null,
  periodEnd: null,
  triggeredAt: T0,
  resolvedAt: null,
  resolutionReason: null,
  dismissedAt: null,
  ...overrides,
});

const isOpen = (alert: Alert) =>
  alert.status === AlertStatus.ACTIVE || alert.status === AlertStatus.DISMISSED;

class FakeAlertsRepository {
  rows: Alert[] = [];
  /** Runs just before an insert: lets a test simulate a concurrent writer. */
  beforeInsert?: () => void;

  openOccurrences(_tx: unknown, userId: string, keys: string[]) {
    return Promise.resolve(
      this.rows
        .filter(
          (alert) =>
            alert.userId === userId &&
            alert.conditionKey !== null &&
            keys.includes(alert.conditionKey) &&
            isOpen(alert),
        )
        .map((alert) => ({ ...alert })),
    );
  }

  latestTriggers(_tx: unknown, userId: string, keys: string[]) {
    const latest = new Map<string, Date>();
    for (const alert of this.rows) {
      if (
        alert.userId !== userId ||
        alert.conditionKey === null ||
        !keys.includes(alert.conditionKey)
      ) {
        continue;
      }
      const seen = latest.get(alert.conditionKey);
      if (!seen || alert.triggeredAt > seen) {
        latest.set(alert.conditionKey, alert.triggeredAt);
      }
    }
    return Promise.resolve(
      [...latest].map(([conditionKey, triggeredAt]) => ({
        conditionKey,
        triggeredAt,
      })),
    );
  }

  insertOccurrence(_tx: unknown, data: Prisma.AlertUncheckedCreateInput) {
    this.beforeInsert?.();
    const conflict = this.rows.some(
      (alert) =>
        alert.userId === data.userId &&
        alert.conditionKey === data.conditionKey &&
        isOpen(alert),
    );
    if (conflict) return Promise.resolve(null); // ON CONFLICT DO NOTHING
    const created = row({
      ...(data as Partial<Alert>),
      status: 'ACTIVE',
      createdAt: data.triggeredAt as Date,
    });
    this.rows.push(created);
    return Promise.resolve(created);
  }

  resolveOccurrences(
    _tx: unknown,
    userId: string,
    ids: string[],
    now: Date,
    reason: string,
  ) {
    let count = 0;
    for (const alert of this.rows) {
      if (alert.userId === userId && ids.includes(alert.id) && isOpen(alert)) {
        alert.status = 'RESOLVED';
        alert.resolvedAt = now;
        alert.resolutionReason = reason;
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

const condition = (
  overrides: Partial<AlertCondition> = {},
): AlertCondition => ({
  key: 'budget:budget-1:2026-09-01:WARNING',
  holds: true,
  type: 'BUDGET_THRESHOLD',
  severity: 'WARNING',
  target: { resourceType: 'budget', resourceId: 'budget-1' },
  threshold: new Prisma.Decimal(80),
  observed: new Prisma.Decimal(85),
  window: {
    start: new Date('2026-08-31T17:00:00.000Z'),
    end: new Date('2026-09-30T17:00:00.000Z'),
  },
  mayCreate: true,
  resolutionReason: 'BELOW_THRESHOLD',
  title: 'Budget warning',
  message: 'Usage reached 85% of the budget',
  metadata: { percentUsed: 85 },
  ...overrides,
});

describe('AlertLifecycleService.applyConditions (T066)', () => {
  let repository: FakeAlertsRepository;
  let service: AlertLifecycleService;

  beforeEach(() => {
    repository = new FakeAlertsRepository();
    service = new AlertLifecycleService(
      repository as unknown as AlertsRepository,
    );
  });

  const apply = (conditions: AlertCondition[], now: Date) =>
    service.applyConditions(TX, USER, conditions, now);
  const open = () => repository.rows.filter(isOpen);

  it('creates an ACTIVE occurrence with the ALERT-001 evidence when the condition holds and nothing is open', async () => {
    const outcome = await apply([condition()], T0);

    expect(outcome.created).toHaveLength(1);
    expect(repository.rows).toHaveLength(1);
    const [alert] = repository.rows;
    expect(alert).toMatchObject({
      userId: USER,
      type: 'BUDGET_THRESHOLD',
      severity: 'WARNING',
      status: 'ACTIVE',
      conditionKey: 'budget:budget-1:2026-09-01:WARNING',
      resourceType: 'budget',
      resourceId: 'budget-1',
      triggeredAt: T0,
      periodStart: new Date('2026-08-31T17:00:00.000Z'),
      periodEnd: new Date('2026-09-30T17:00:00.000Z'),
      title: 'Budget warning',
      message: 'Usage reached 85% of the budget',
      isRead: false,
    });
    expect(String(alert.thresholdValue)).toBe('80');
    expect(String(alert.observedValue)).toBe('85');
    expect(alert.metadata).toEqual({ percentUsed: 85 });
  });

  it('does not create a duplicate while an ACTIVE occurrence is open', async () => {
    await apply([condition()], T0);
    const outcome = await apply([condition()], at(25 * HOUR));

    expect(outcome.created).toHaveLength(0);
    expect(repository.rows).toHaveLength(1);
  });

  it('does not create while a DISMISSED occurrence is open (dismissal is not resolution)', async () => {
    await apply([condition()], T0);
    repository.rows[0].status = 'DISMISSED';
    repository.rows[0].dismissedAt = at(HOUR);

    const outcome = await apply([condition()], at(48 * HOUR));

    expect(outcome.created).toHaveLength(0);
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].status).toBe('DISMISSED');
  });

  it('resolves an ACTIVE occurrence when the condition no longer holds', async () => {
    await apply([condition()], T0);
    const outcome = await apply([condition({ holds: false })], at(HOUR));

    expect(outcome.resolved).toEqual([
      {
        id: repository.rows[0].id,
        key: 'budget:budget-1:2026-09-01:WARNING',
        reason: 'BELOW_THRESHOLD',
      },
    ]);
    expect(repository.rows[0]).toMatchObject({
      status: 'RESOLVED',
      resolvedAt: at(HOUR),
      resolutionReason: 'BELOW_THRESHOLD',
    });
  });

  it('resolves a DISMISSED occurrence and keeps its dismissal time and read state', async () => {
    await apply([condition()], T0);
    Object.assign(repository.rows[0], {
      status: 'DISMISSED',
      dismissedAt: at(HOUR),
      isRead: true,
      readAt: at(HOUR),
    });

    await apply(
      [condition({ holds: false, resolutionReason: 'PERIOD_ENDED' })],
      at(2 * HOUR),
    );

    expect(repository.rows[0]).toMatchObject({
      status: 'RESOLVED',
      resolvedAt: at(2 * HOUR),
      resolutionReason: 'PERIOD_ENDED',
      dismissedAt: at(HOUR),
      isRead: true,
      readAt: at(HOUR),
    });
  });

  it('stores nothing for a crossing within 24h of the last trigger (cooldown)', async () => {
    await apply([condition()], T0);
    await apply([condition({ holds: false })], at(HOUR));

    const outcome = await apply([condition()], at(24 * HOUR - 1));

    expect(outcome.created).toHaveLength(0);
    expect(outcome.suppressed).toEqual(['budget:budget-1:2026-09-01:WARNING']);
    expect(repository.rows).toHaveLength(1);
    expect(open()).toHaveLength(0);
  });

  it('creates at the first evaluation at or after 24h since the last trigger', async () => {
    await apply([condition()], T0);
    await apply([condition({ holds: false })], at(HOUR));
    await apply([condition()], at(2 * HOUR)); // suppressed, not stored

    const outcome = await apply([condition()], at(ALERT_COOLDOWN_MS));

    expect(outcome.created).toHaveLength(1);
    expect(repository.rows).toHaveLength(2);
    expect(open()).toHaveLength(1);
    expect(open()[0].triggeredAt).toEqual(at(ALERT_COOLDOWN_MS));
  });

  it('measures the cooldown from the latest trigger, not the latest resolution', async () => {
    await apply([condition()], T0);
    await apply([condition({ holds: false })], at(23 * HOUR));

    const outcome = await apply([condition()], at(24 * HOUR));

    expect(outcome.created).toHaveLength(1);
  });

  it('treats a concurrent unique violation as already open: one open row, no error', async () => {
    repository.beforeInsert = () => {
      repository.beforeInsert = undefined;
      repository.rows.push(
        row({ conditionKey: 'budget:budget-1:2026-09-01:WARNING' }),
      );
    };

    const outcome = await apply([condition()], T0);

    expect(outcome.created).toHaveLength(0);
    expect(open()).toHaveLength(1);
  });

  it('never touches null-key (legacy or user-authored) rows', async () => {
    const legacy = row({
      conditionKey: null,
      type: 'BUDGET_THRESHOLD',
      severity: 'WARNING',
      resourceType: 'budget',
      resourceId: 'budget-1',
      triggeredAt: at(-HOUR),
    });
    repository.rows.push(legacy);
    const snapshot = { ...legacy };

    await apply([condition({ holds: false })], T0);
    await apply([condition()], at(HOUR));
    await apply([condition({ holds: false })], at(2 * HOUR));

    expect(repository.rows[0]).toEqual(snapshot);
  });

  it('opens nothing when a creation limit forbids it, but still resolves', async () => {
    const outcome = await apply([condition({ mayCreate: false })], T0);
    expect(outcome.created).toHaveLength(0);
    expect(repository.rows).toHaveLength(0);

    await apply([condition()], at(HOUR));
    await apply(
      [
        condition({
          mayCreate: false,
          holds: false,
          resolutionReason: 'PERIOD_ENDED',
        }),
      ],
      at(2 * HOUR),
    );
    expect(repository.rows[0]).toMatchObject({
      status: 'RESOLVED',
      resolutionReason: 'PERIOD_ENDED',
    });
  });

  it('keeps severity tiers independent: warning and critical have their own lifecycle and cooldown', async () => {
    const warning = condition();
    const critical = condition({
      key: 'budget:budget-1:2026-09-01:CRITICAL',
      severity: 'CRITICAL',
      threshold: new Prisma.Decimal(100),
      observed: new Prisma.Decimal(120),
    });

    const both = await apply([warning, critical], T0);
    expect(both.created.map((alert) => alert.severity)).toEqual([
      'WARNING',
      'CRITICAL',
    ]);

    await apply([warning, { ...critical, holds: false }], at(HOUR));
    expect(open().map((alert) => alert.severity)).toEqual(['WARNING']);
  });

  it('never resolves or re-creates a RESOLVED row: resolution is terminal', async () => {
    await apply([condition()], T0);
    await apply([condition({ holds: false })], at(HOUR));
    const resolved = { ...repository.rows[0] };

    await apply(
      [condition({ holds: false, resolutionReason: 'PERIOD_ENDED' })],
      at(2 * HOUR),
    );

    expect(repository.rows[0]).toEqual(resolved);
  });

  it('stores out-of-range evidence as null instead of failing the insert (review finding)', async () => {
    const outcome = await apply(
      [
        condition({
          threshold: new Prisma.Decimal('100000000000000'),
          observed: new Prisma.Decimal('-99999999999999.99999'),
        }),
      ],
      T0,
    );
    expect(outcome.created).toHaveLength(1);
    expect(repository.rows[0].thresholdValue).toBeNull();
    expect(repository.rows[0].observedValue).toBeNull();
  });

  it.each([
    ['123.456789', '123.4568'],
    ['99999999999999.9999', '99999999999999.9999'],
    ['-5', '-5'],
  ])('keeps in-range evidence %s as %s', (value, stored) => {
    expect(storableEvidence(new Prisma.Decimal(value))?.toString()).toBe(
      stored,
    );
  });

  it('passes null evidence through', () => {
    expect(storableEvidence(null)).toBeNull();
  });

  it("ignores another user's rows with the same key", async () => {
    repository.rows.push(
      row({
        userId: 'user-2',
        conditionKey: 'budget:budget-1:2026-09-01:WARNING',
        triggeredAt: T0,
      }),
    );

    const outcome = await apply([condition()], at(HOUR));

    expect(outcome.created).toHaveLength(1);
    expect(repository.rows[1].status).toBe('ACTIVE');
  });
});
