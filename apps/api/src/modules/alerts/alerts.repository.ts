import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAlertsDto } from './dto/list-alerts.dto';
import { UpdateAlertSettingDto } from './dto/update-alert-setting.dto';
import { buildAlertWhere } from './query/alerts.query';

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
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.alert.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.alert.findFirst({ where: { id, userId } });
  }

  create(data: Prisma.AlertUncheckedCreateInput) {
    return this.prisma.alert.create({ data });
  }

  markRead(id: string) {
    return this.prisma.alert.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  markAllRead(userId: string) {
    return this.prisma.alert.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
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
