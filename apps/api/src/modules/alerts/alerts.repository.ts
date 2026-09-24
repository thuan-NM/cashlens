import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';
import { buildAlertWhere } from './query/alerts.query';

/** The email outcome shown with every alert (null when none exists). */
const WITH_DELIVERY = {
  deliveries: { where: { channel: 'EMAIL' } },
} satisfies Prisma.AlertInclude;

@Injectable()
export class AlertsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByUser(userId: string, query: ListAlertsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = buildAlertWhere(userId, query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        include: WITH_DELIVERY,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.alert.findFirst({
      where: { id, userId },
      include: WITH_DELIVERY,
    });
  }

  /** ALERT-004, ALERT-010: every unread alert, whatever its status. */
  unreadCount(userId: string) {
    return this.prisma.alert.count({ where: { userId, isRead: false } });
  }

  /**
   * ACTIVE -> DISMISSED (ALERT-010); also marks the alert read, keeping an
   * earlier read time. Conditional on ACTIVE, so a concurrent resolution
   * wins; 0 means the row is no longer ACTIVE.
   */
  async dismiss(userId: string, id: string, now: Date, readAt: Date | null) {
    const { count } = await this.prisma.alert.updateMany({
      where: { id, userId, status: 'ACTIVE' },
      data: {
        status: 'DISMISSED',
        dismissedAt: now,
        isRead: true,
        readAt: readAt ?? now,
      },
    });
    return count;
  }

  create(data: Prisma.AlertUncheckedCreateInput) {
    return this.prisma.alert.create({ data });
  }

  // The owner predicate is part of the write (SEC-001); null means not found.
  markRead(userId: string, id: string) {
    return nullIfNotFound(
      this.prisma.alert.update({
        where: { id, userId },
        data: { isRead: true, readAt: new Date() },
        include: WITH_DELIVERY,
      }),
    );
  }

  /**
   * Takes the user's evaluation lock first, so this multi-row update never
   * interleaves with an evaluation resolving several rows (which could
   * deadlock); it waits for a running evaluation instead.
   */
  markAllRead(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserEvaluation(tx, userId);
      return tx.alert.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });
    });
  }

  // --- condition lifecycle (T067): always inside the evaluation transaction ---

  /**
   * Serializes one user's evaluations for the rest of the transaction, so
   * evaluators never race on the same keys; the partial unique index stays
   * the backstop.
   */
  lockUserEvaluation(tx: Prisma.TransactionClient, userId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'alerts:' + userId}))`;
  }

  /** Open (ACTIVE or DISMISSED) occurrences of the given keys. */
  openOccurrences(
    tx: Prisma.TransactionClient,
    userId: string,
    keys: string[],
  ) {
    return tx.alert.findMany({
      where: {
        userId,
        conditionKey: { in: keys },
        status: { in: ['ACTIVE', 'DISMISSED'] },
      },
    });
  }

  /** Open occurrences whose key starts with `prefix` (stale-key sweeps). */
  openOccurrencesWithPrefix(
    tx: Prisma.TransactionClient,
    userId: string,
    prefix: string,
  ) {
    return tx.alert.findMany({
      where: {
        userId,
        conditionKey: { startsWith: prefix },
        status: { in: ['ACTIVE', 'DISMISSED'] },
      },
      select: { conditionKey: true },
    });
  }

  /** The latest trigger time of each key, open or not (cooldown lookup). */
  async latestTriggers(
    tx: Prisma.TransactionClient,
    userId: string,
    keys: string[],
  ) {
    const rows = await tx.alert.groupBy({
      by: ['conditionKey'],
      where: { userId, conditionKey: { in: keys } },
      _max: { triggeredAt: true },
    });
    return rows
      .filter((row) => row.conditionKey && row._max.triggeredAt)
      .map((row) => ({
        conditionKey: row.conditionKey as string,
        triggeredAt: row._max.triggeredAt as Date,
      }));
  }

  /**
   * Inserts one open occurrence; null when the partial unique index already
   * holds an open row for the key (a concurrent evaluator won). ON CONFLICT
   * DO NOTHING keeps the transaction usable, which a caught unique violation
   * would not.
   */
  async insertOccurrence(
    tx: Prisma.TransactionClient,
    data: Prisma.AlertUncheckedCreateInput,
  ) {
    const [created] = await tx.alert.createManyAndReturn({
      data: [data as Prisma.AlertCreateManyInput],
      skipDuplicates: true,
    });
    return created ?? null;
  }

  /** System resolution (ALERT-010): open rows only; dismissal time is kept. */
  async resolveOccurrences(
    tx: Prisma.TransactionClient,
    userId: string,
    ids: string[],
    now: Date,
    reason: string,
  ) {
    const { count } = await tx.alert.updateMany({
      where: {
        id: { in: ids },
        userId,
        status: { in: ['ACTIVE', 'DISMISSED'] },
      },
      data: { status: 'RESOLVED', resolvedAt: now, resolutionReason: reason },
    });
    return count;
  }

  listSettings(userId: string) {
    return this.prisma.alertSetting.findMany({
      where: { userId },
      orderBy: [{ type: 'asc' }],
    });
  }

  createManySettings(data: Prisma.AlertSettingCreateManyInput[]) {
    return this.prisma.alertSetting.createMany({ data, skipDuplicates: true });
  }

  upsertSetting(userId: string, dto: UpdateAlertSettingDto) {
    return this.prisma.alertSetting.upsert({
      where: { userId_type: { userId, type: dto.type } },
      create: {
        userId,
        type: dto.type,
        inAppEnabled: dto.inAppEnabled ?? true,
        emailEnabled: dto.emailEnabled ?? false,
        threshold: dto.threshold,
        metadata: dto.metadata,
      },
      update: {
        inAppEnabled: dto.inAppEnabled,
        emailEnabled: dto.emailEnabled,
        threshold: dto.threshold,
        metadata: dto.metadata,
      },
    });
  }
}
