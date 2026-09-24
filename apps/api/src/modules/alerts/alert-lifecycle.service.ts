import { Injectable } from '@nestjs/common';
import type { Alert, Prisma } from '@prisma/client';
import { AlertsRepository } from './alerts.repository';
import {
  ALERT_COOLDOWN_MS,
  AlertCondition,
  AlertResolutionReason,
} from './evaluators/alert-condition';

/** `Alert.thresholdValue`/`observedValue` are `Decimal(18,4)`: below 1e14. */
const EVIDENCE_LIMIT = 1e14;

/**
 * A threshold or observed value as the column can store it: 4 decimal
 * places, or null when it is out of range (for example a goal target near
 * the Decimal(18,2) maximum). The exact value stays in the sanitized
 * metadata, and an overflow can never abort the evaluation transaction.
 */
export const storableEvidence = (
  value: Prisma.Decimal | null,
): Prisma.Decimal | null => {
  if (value === null) return null;
  const rounded = value.toDecimalPlaces(4);
  return rounded.abs().lt(EVIDENCE_LIMIT) ? rounded : null;
};

export type LifecycleOutcome = {
  created: Alert[];
  resolved: { id: string; key: string; reason: AlertResolutionReason }[];
  /** Keys whose crossing the cooldown suppressed; nothing is stored. */
  suppressed: string[];
};

/**
 * The level-triggered lifecycle (ALERT-002, ALERT-003, ALERT-010), applied
 * inside the caller's evaluation transaction:
 *
 * - a condition that no longer holds resolves its open occurrence, ACTIVE or
 *   DISMISSED, keeping `dismissedAt` and the read state;
 * - a condition that holds opens an occurrence only when none is open, the
 *   creation limit allows it, and 24h have passed since the key's latest
 *   trigger. A crossing inside the cooldown is not stored.
 *
 * Only keyed rows are ever read or written, so legacy and user-authored
 * (null-key) alerts are never touched. Read state is never changed here.
 */
@Injectable()
export class AlertLifecycleService {
  constructor(private readonly repository: AlertsRepository) {}

  async applyConditions(
    tx: Prisma.TransactionClient,
    userId: string,
    conditions: AlertCondition[],
    now: Date,
  ): Promise<LifecycleOutcome> {
    const outcome: LifecycleOutcome = {
      created: [],
      resolved: [],
      suppressed: [],
    };
    // One condition per key; the first wins.
    const byKey = new Map<string, AlertCondition>();
    for (const condition of conditions) {
      if (!byKey.has(condition.key)) byKey.set(condition.key, condition);
    }
    if (!byKey.size) return outcome;
    const keys = [...byKey.keys()];

    const open = new Map(
      (await this.repository.openOccurrences(tx, userId, keys)).map((alert) => [
        alert.conditionKey as string,
        alert,
      ]),
    );

    // Resolutions first, grouped by reason.
    const toResolve = new Map<
      AlertResolutionReason,
      { id: string; key: string }[]
    >();
    for (const condition of byKey.values()) {
      const current = open.get(condition.key);
      if (condition.holds || !current) continue;
      const group = toResolve.get(condition.resolutionReason) ?? [];
      group.push({ id: current.id, key: condition.key });
      toResolve.set(condition.resolutionReason, group);
    }
    for (const [reason, group] of toResolve) {
      await this.repository.resolveOccurrences(
        tx,
        userId,
        group.map((item) => item.id),
        now,
        reason,
      );
      outcome.resolved.push(...group.map((item) => ({ ...item, reason })));
    }

    const candidates = [...byKey.values()].filter(
      (condition) =>
        condition.holds && condition.mayCreate && !open.has(condition.key),
    );
    if (!candidates.length) return outcome;

    const latest = new Map(
      (
        await this.repository.latestTriggers(
          tx,
          userId,
          candidates.map((condition) => condition.key),
        )
      ).map((row) => [row.conditionKey, row.triggeredAt]),
    );
    for (const condition of candidates) {
      const last = latest.get(condition.key);
      if (last && now.getTime() - last.getTime() < ALERT_COOLDOWN_MS) {
        outcome.suppressed.push(condition.key);
        continue;
      }
      const created = await this.repository.insertOccurrence(tx, {
        userId,
        type: condition.type,
        severity: condition.severity,
        title: condition.title,
        message: condition.message,
        resourceType: condition.target.resourceType,
        resourceId: condition.target.resourceId,
        metadata: condition.metadata,
        status: 'ACTIVE',
        conditionKey: condition.key,
        thresholdValue: storableEvidence(condition.threshold),
        observedValue: storableEvidence(condition.observed),
        periodStart: condition.window?.start ?? null,
        periodEnd: condition.window?.end ?? null,
        triggeredAt: now,
        createdAt: now,
      });
      // null: a concurrent evaluator opened it first; that row stands.
      if (created) outcome.created.push(created);
    }
    return outcome;
  }
}
