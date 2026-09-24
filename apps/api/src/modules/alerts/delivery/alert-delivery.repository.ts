import { Injectable } from '@nestjs/common';
import type { AlertType, Prisma } from '@prisma/client';
import { Clock } from '../../../common/time/clock';
import { PrismaService } from '../../../prisma/prisma.service';

export type DeliveryForSend = {
  id: string;
  status: string;
  attemptCount: number;
  alert: { id: string; type: AlertType };
  recipient: string;
};

/**
 * AlertDelivery persistence (DB-M5). Every state change after creation is
 * conditional on the row still being PENDING (and, for an attempt, on the
 * expected attempt count), so two writers can never send the same attempt
 * or overwrite a terminal outcome.
 */
@Injectable()
export class AlertDeliveryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  create(
    tx: Prisma.TransactionClient,
    data: Prisma.AlertDeliveryUncheckedCreateInput,
  ) {
    return tx.alertDelivery.create({ data });
  }

  async findForSend(id: string): Promise<DeliveryForSend | null> {
    const row = await this.prisma.alertDelivery.findUnique({
      where: { id },
      include: {
        alert: { select: { id: true, type: true } },
        user: { select: { email: true } },
      },
    });
    return row
      ? {
          id: row.id,
          status: row.status,
          attemptCount: row.attemptCount,
          alert: row.alert,
          recipient: row.user.email,
        }
      : null;
  }

  /** Persists attempt `attempt` before it is made; false when superseded. */
  async recordAttempt(id: string, attempt: number, at: Date) {
    const { count } = await this.prisma.alertDelivery.updateMany({
      where: { id, status: 'PENDING', attemptCount: attempt - 1 },
      data: { attemptCount: attempt, lastAttemptAt: at },
    });
    return count === 1;
  }

  async markSent(id: string, at: Date) {
    await this.prisma.alertDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'SENT',
        sentAt: at,
        failureCode: null,
        failureMessage: null,
      },
    });
  }

  async markFailed(id: string, code: string, message: string) {
    await this.prisma.alertDelivery.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'FAILED', failureCode: code, failureMessage: message },
    });
  }

  /**
   * PENDING rows whose last attempt (or creation, before any attempt) is
   * older than `cutoff` become FAILED/INTERRUPTED; they are never resent.
   */
  async sweepInterrupted(userId: string, cutoff: Date) {
    const { count } = await this.prisma.alertDelivery.updateMany({
      where: {
        userId,
        status: 'PENDING',
        OR: [
          { lastAttemptAt: { lt: cutoff } },
          { lastAttemptAt: null, createdAt: { lt: cutoff } },
        ],
      },
      data: {
        status: 'FAILED',
        failureCode: 'INTERRUPTED',
        failureMessage: 'The delivery was interrupted and was not resent',
      },
    });
    return count;
  }

  now() {
    return this.clock.now();
  }
}
