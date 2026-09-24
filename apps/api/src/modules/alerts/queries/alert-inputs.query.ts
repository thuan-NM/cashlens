import { Injectable } from '@nestjs/common';
import { AlertType, Prisma } from '@prisma/client';
import {
  budgetSpend,
  monthlyInstanceAt,
} from '../../../common/finance/budget-spend.query';
import {
  CompletedMonthCashflow,
  completedMonthCashflow,
} from '../../../common/finance/completed-month-cashflow';
import {
  PeriodSettings,
  normalizeCurrency,
} from '../../../common/finance/financial-period-policy';
import { loadFinancialContext } from '../../../common/finance/financial-summary.query';
import type { BudgetEvaluationBudget } from '../evaluators/budget-threshold.evaluator';
import type { GoalEvaluationGoal } from '../evaluators/goal-risk.evaluator';
import type { LargeTransactionRow } from '../evaluators/large-transaction.evaluator';
import type { ReconnectConnection } from '../evaluators/reconnect-required.evaluator';
import type { SyncFailureConnection } from '../evaluators/sync-failure.evaluator';

type Db = Prisma.TransactionClient;

export type TypePreference = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  threshold: Prisma.Decimal | null;
};

export type EvaluationContext = {
  settings: PeriodSettings;
  baseCurrency: string;
  notificationEnabled: boolean;
  preference: (type: AlertType) => TypePreference;
};

const DEFAULT_PREFERENCE: TypePreference = {
  inAppEnabled: true,
  emailEnabled: false,
  threshold: null,
};

/**
 * Persisted inputs of the alert evaluators (T079), read inside the
 * evaluation transaction. It depends only on the database client and the
 * shared finance helpers (`financial-period-policy`, `financial-summary`,
 * `completed-month-cashflow`, `budget-spend.query`), never on a feature
 * module, so AlertsModule imports none (plan.md "Alert module dependency
 * direction").
 */
@Injectable()
export class AlertInputsQuery {
  /** Period settings, base currency, and delivery preferences. */
  async context(db: Db, userId: string): Promise<EvaluationContext> {
    const [financial, alertSettings, userSettings] = await Promise.all([
      loadFinancialContext(db, userId),
      db.alertSetting.findMany({ where: { userId } }),
      db.userSettings.findUnique({
        where: { userId },
        select: { notificationEnabled: true },
      }),
    ]);
    const byType = new Map(
      alertSettings.map((setting) => [setting.type, setting]),
    );
    return {
      settings: financial.settings,
      baseCurrency: financial.baseCurrency,
      // No settings row: the column default (notifications on).
      notificationEnabled: userSettings?.notificationEnabled ?? true,
      preference: (type) => {
        const setting = byType.get(type);
        return setting
          ? {
              inAppEnabled: setting.inAppEnabled,
              emailEnabled: setting.emailEnabled,
              threshold: setting.threshold,
            }
          : DEFAULT_PREFERENCE;
      },
    };
  }

  /** The user's open condition keys that start with `prefix`. */
  async openKeys(db: Db, userId: string, prefix: string) {
    const rows = await db.alert.findMany({
      where: {
        userId,
        conditionKey: { startsWith: prefix },
        status: { in: ['ACTIVE', 'DISMISSED'] },
      },
      select: { conditionKey: true },
    });
    return rows.map((row) => row.conditionKey as string);
  }

  /**
   * Active, non-archived budgets with their spend in the MONTHLY instance
   * containing `now` (0 for other periods, which are not evaluated).
   */
  async budgets(
    db: Db,
    userId: string,
    now: Date,
    settings: PeriodSettings,
  ): Promise<BudgetEvaluationBudget[]> {
    const budgets = await db.budget.findMany({
      where: { userId, deletedAt: null, isActive: true },
      orderBy: { id: 'asc' },
    });
    const scopes = budgets.flatMap((budget) => {
      const result = monthlyInstanceAt(budget, now, settings);
      return result.supported && result.instance
        ? [
            {
              id: budget.id,
              categoryId: budget.categoryId,
              currency: budget.currency,
              range: result.instance.usage,
            },
          ]
        : [];
    });
    const spend = await budgetSpend(db, userId, scopes);
    return budgets.map((budget) => ({
      id: budget.id,
      name: budget.name,
      period: budget.period,
      categoryId: budget.categoryId,
      currency: budget.currency,
      amount: budget.amount,
      thresholdPercent: budget.thresholdPercent,
      startsAt: budget.startsAt,
      endsAt: budget.endsAt,
      spent: spend.get(budget.id) ?? new Prisma.Decimal(0),
    }));
  }

  /** Non-deleted goals, each with its currency's completed-month cashflow. */
  async goals(
    db: Db,
    userId: string,
    now: Date,
    settings: PeriodSettings,
  ): Promise<GoalEvaluationGoal[]> {
    const goals = await db.goal.findMany({
      where: { userId, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    const observations = new Map<string, CompletedMonthCashflow>();
    for (const currency of new Set(
      goals
        .filter((goal) => goal.status === 'ACTIVE')
        .map((goal) => normalizeCurrency(goal.currency)),
    )) {
      observations.set(
        currency,
        await completedMonthCashflow(db, userId, currency, now, settings),
      );
    }
    const none: CompletedMonthCashflow = {
      currency: '',
      historyStartMonth: null,
      months: [],
    };
    return goals.map((goal) => ({
      ...goal,
      observation: observations.get(normalizeCurrency(goal.currency)) ?? none,
    }));
  }

  /** Completed-month cashflow in the base currency (cashflow risk). */
  cashflow(
    db: Db,
    userId: string,
    baseCurrency: string,
    now: Date,
    settings: PeriodSettings,
  ) {
    return completedMonthCashflow(db, userId, baseCurrency, now, settings);
  }

  /** The changed transactions; a missing id means the row is gone. */
  async transactions(
    db: Db,
    userId: string,
    ids: string[],
  ): Promise<{ id: string; row: LargeTransactionRow | null }[]> {
    if (!ids.length) return [];
    const rows = await db.transaction.findMany({
      where: { userId, id: { in: ids } },
      select: {
        id: true,
        amount: true,
        currency: true,
        direction: true,
        status: true,
        isDuplicate: true,
        transactionTime: true,
      },
    });
    const byId = new Map(rows.map(({ id, ...row }) => [id, row]));
    return [...new Set(ids)].map((id) => ({ id, row: byId.get(id) ?? null }));
  }

  /** Every connection of the user, disconnected ones included. */
  connections(db: Db, userId: string): Promise<ReconnectConnection[]> {
    return db.emailConnection.findMany({
      where: { userId },
      select: { id: true, status: true, disconnectedAt: true },
      orderBy: { id: 'asc' },
    });
  }

  /** Each connection with its three most recent terminal runs, newest first. */
  async connectionRuns(
    db: Db,
    userId: string,
  ): Promise<SyncFailureConnection[]> {
    const connections = await this.connections(db, userId);
    const result: SyncFailureConnection[] = [];
    for (const connection of connections) {
      const runs = await db.emailSyncRun.findMany({
        where: { emailConnectionId: connection.id, status: { not: 'RUNNING' } },
        orderBy: [
          { finishedAt: { sort: 'desc', nulls: 'last' } },
          { startedAt: 'desc' },
          { id: 'desc' },
        ],
        take: 3,
        select: { id: true, status: true, finishedAt: true },
      });
      result.push({
        id: connection.id,
        disconnectedAt: connection.disconnectedAt,
        recentTerminalRuns: runs,
      });
    }
    return result;
  }
}
