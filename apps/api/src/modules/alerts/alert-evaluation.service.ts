import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../../common/time/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertLifecycleService } from './alert-lifecycle.service';
import { AlertsRepository } from './alerts.repository';
import { AlertDeliveryService } from './delivery/alert-delivery.service';
import type { AlertCondition } from './evaluators/alert-condition';
import { evaluateBudgetThresholds } from './evaluators/budget-threshold.evaluator';
import { evaluateCashflowRisk } from './evaluators/cashflow-risk.evaluator';
import { KEY_PREFIX } from './evaluators/condition-keys';
import { evaluateGoalRisk } from './evaluators/goal-risk.evaluator';
import { evaluateLargeTransactions } from './evaluators/large-transaction.evaluator';
import { evaluateReconnectRequired } from './evaluators/reconnect-required.evaluator';
import { evaluateSyncFailures } from './evaluators/sync-failure.evaluator';
import { AlertInputsQuery } from './queries/alert-inputs.query';

/** The condition families one trigger re-evaluates (ALERT-009 "Evaluated on"). */
type Family =
  | 'BUDGET'
  | 'LARGE_TRANSACTION'
  | 'GOAL'
  | 'CASHFLOW'
  | 'SYNC_FAILURE'
  | 'RECONNECT';

export type EvaluationResult = {
  correlationId: string;
  ok: boolean;
  created: number;
  resolved: number;
};

/**
 * The alert evaluation orchestrator (T079, ALERT-003, ALERT-005, ALERT-006,
 * ALERT-009). Callers invoke an entry point only after their financial write
 * has committed; nothing here can fail or roll back that write.
 *
 * One evaluation:
 * 1. marks interrupted deliveries of the user (ALERT-006);
 * 2. in its own transaction, under a per-user advisory lock, reads the
 *    inputs, runs the pure evaluators for the triggered families over the
 *    user's current state (level-triggered), applies the lifecycle, and
 *    writes one delivery outcome per new alert;
 * 3. after that commit, attempts the PENDING emails, bounded.
 *
 * Disabling in-app for a type stops new occurrences of it, while open ones
 * still resolve. Any error is logged with a correlation id and swallowed;
 * the next trigger re-evaluates the same conditions. There is no scheduler,
 * queue, or event bus.
 */
@Injectable()
export class AlertEvaluationService {
  private readonly logger = new Logger(AlertEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly inputs: AlertInputsQuery,
    private readonly lifecycle: AlertLifecycleService,
    private readonly delivery: AlertDeliveryService,
    private readonly alerts: AlertsRepository,
  ) {}

  /**
   * Any eligible transaction mutation (create, update, delete, ignore,
   * duplicate, category change), manual or imported. Budgets, goals, and
   * cashflow are re-evaluated over the whole current state, which covers the
   * old and the new period and category of a move. `largeTransactionIds` are
   * the transactions created, or updated in amount, currency, direction, or
   * eligibility: the only ones the large-transaction row re-evaluates.
   */
  onTransactionsChanged(
    userId: string,
    change: { largeTransactionIds?: string[] } = {},
  ) {
    return this.evaluate(
      userId,
      ['BUDGET', 'GOAL', 'CASHFLOW', 'LARGE_TRANSACTION'],
      change.largeTransactionIds ?? [],
    );
  }

  /** Budget create, update, archive, or explicit recalculation. */
  onBudgetChanged(userId: string) {
    return this.evaluate(userId, ['BUDGET']);
  }

  /** Goal create, update, contribution, status change, or archive. */
  onGoalChanged(userId: string) {
    return this.evaluate(userId, ['GOAL']);
  }

  /** A sync run reached a terminal state, including a lease expiry. */
  onSyncRunFinished(userId: string) {
    return this.evaluate(userId, ['SYNC_FAILURE', 'RECONNECT']);
  }

  /** Connect, reconnect, disconnect, or a provider-auth failure. */
  onConnectionStatusChanged(userId: string) {
    return this.evaluate(userId, ['RECONNECT', 'SYNC_FAILURE']);
  }

  private async evaluate(
    userId: string,
    families: Family[],
    largeTransactionIds: string[] = [],
  ): Promise<EvaluationResult> {
    const correlationId = randomUUID();
    try {
      await this.delivery.sweepInterrupted(userId);
      const outcome = await this.prisma.$transaction(
        async (tx) => {
          await this.alerts.lockUserEvaluation(tx, userId);
          const now = this.clock.now();
          const context = await this.inputs.context(tx, userId);
          const conditions: AlertCondition[] = [];
          const has = (family: Family) => families.includes(family);

          if (has('BUDGET')) {
            conditions.push(
              ...evaluateBudgetThresholds({
                now,
                settings: context.settings,
                budgets: await this.inputs.budgets(
                  tx,
                  userId,
                  now,
                  context.settings,
                ),
                openKeys: await this.inputs.openKeys(
                  tx,
                  userId,
                  KEY_PREFIX.budget,
                ),
              }),
            );
          }
          if (has('LARGE_TRANSACTION') && largeTransactionIds.length) {
            conditions.push(
              ...evaluateLargeTransactions({
                now,
                settings: context.settings,
                baseCurrency: context.baseCurrency,
                threshold: context.preference('LARGE_TRANSACTION').threshold,
                transactions: await this.inputs.transactions(
                  tx,
                  userId,
                  largeTransactionIds,
                ),
              }),
            );
          }
          if (has('GOAL')) {
            conditions.push(
              ...evaluateGoalRisk({
                now,
                settings: context.settings,
                goals: await this.inputs.goals(
                  tx,
                  userId,
                  now,
                  context.settings,
                ),
                openKeys: await this.inputs.openKeys(
                  tx,
                  userId,
                  KEY_PREFIX.goal,
                ),
              }),
            );
          }
          if (has('CASHFLOW')) {
            conditions.push(
              ...evaluateCashflowRisk({
                now,
                settings: context.settings,
                userId,
                baseCurrency: context.baseCurrency,
                observation: await this.inputs.cashflow(
                  tx,
                  userId,
                  context.baseCurrency,
                  now,
                  context.settings,
                ),
              }),
            );
          }
          if (has('SYNC_FAILURE')) {
            conditions.push(
              ...evaluateSyncFailures({
                connections: await this.inputs.connectionRuns(tx, userId),
                openKeys: await this.inputs.openKeys(
                  tx,
                  userId,
                  KEY_PREFIX.syncFailure,
                ),
              }),
            );
          }
          if (has('RECONNECT')) {
            conditions.push(
              ...evaluateReconnectRequired({
                connections: await this.inputs.connections(tx, userId),
                openKeys: await this.inputs.openKeys(
                  tx,
                  userId,
                  KEY_PREFIX.reconnect,
                ),
              }),
            );
          }

          // In-app off for a type: no new occurrence, but resolution applies.
          const gated = conditions.map((condition) =>
            context.preference(condition.type).inAppEnabled
              ? condition
              : { ...condition, mayCreate: false },
          );
          const applied = await this.lifecycle.applyConditions(
            tx,
            userId,
            gated,
            now,
          );
          const pending: string[] = [];
          for (const alert of applied.created) {
            const planned = await this.delivery.plan(tx, alert, {
              emailEnabled: context.preference(alert.type).emailEnabled,
              notificationEnabled: context.notificationEnabled,
            });
            if (planned?.status === 'PENDING') pending.push(planned.id);
          }
          return { applied, pending };
        },
        { timeout: 20_000, maxWait: 10_000 },
      );

      // Email only after the alert and its delivery row are committed. The
      // deliveries run side by side: each records its first attempt at once,
      // so none waits long enough to look interrupted to a concurrent read,
      // and the caller waits one delivery budget, not one per alert.
      await Promise.all(
        outcome.pending.map((deliveryId) => this.delivery.deliver(deliveryId)),
      );
      return {
        correlationId,
        ok: true,
        created: outcome.applied.created.length,
        resolved: outcome.applied.resolved.length,
      };
    } catch (error) {
      this.logger.error(
        `Alert evaluation ${correlationId} for families ${families.join(',')} failed: ${error instanceof Error ? error.name : 'error'}`,
      );
      return { correlationId, ok: false, created: 0, resolved: 0 };
    }
  }
}
