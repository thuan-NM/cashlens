import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EmailListenRulesRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string) {
    return this.prisma.emailListenRule.findMany({
      where: { userId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  findOwned(userId: string, id: string) {
    return this.prisma.emailListenRule.findFirst({ where: { id, userId } });
  }

  create(data: Prisma.EmailListenRuleUncheckedCreateInput) {
    return this.prisma.emailListenRule.create({ data });
  }

  update(id: string, data: Prisma.EmailListenRuleUncheckedUpdateInput) {
    return this.prisma.emailListenRule.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.emailListenRule.delete({ where: { id } });
  }

  connectionOwned(userId: string, id: string) {
    return this.prisma.emailConnection.findFirst({
      where: { id, userId, disconnectedAt: null },
      select: { id: true },
    });
  }

  bankProviderExists(id: string) {
    return this.prisma.bankProvider.findUnique({
      where: { id },
      select: { id: true },
    });
  }
}
