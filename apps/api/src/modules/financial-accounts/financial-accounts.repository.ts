import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ListFinancialAccountsDto } from './dto/list-financial-accounts.dto';
import { buildFinancialAccountWhere } from './query/financial-accounts.query';

@Injectable()
export class FinancialAccountsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string, query: ListFinancialAccountsDto) {
    return this.prisma.financialAccount.findMany({
      where: buildFinancialAccountWhere(userId, query),
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.financialAccount.findFirst({
      where: { id, userId, deletedAt: null },
    });
  }

  create(data: Prisma.FinancialAccountUncheckedCreateInput) {
    return this.prisma.financialAccount.create({ data });
  }

  updateById(id: string, data: Prisma.FinancialAccountUncheckedUpdateInput) {
    return this.prisma.financialAccount.update({ where: { id }, data });
  }

  async createWithDefaultReset(
    userId: string,
    data: Prisma.FinancialAccountUncheckedCreateInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.financialAccount.updateMany({
        where: { userId, deletedAt: null },
        data: { isDefault: false },
      });

      return tx.financialAccount.create({ data });
    });
  }

  async updateWithDefaultReset(
    userId: string,
    id: string,
    data: Prisma.FinancialAccountUncheckedUpdateInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.financialAccount.updateMany({
        where: { userId, deletedAt: null, id: { not: id } },
        data: { isDefault: false },
      });

      return tx.financialAccount.update({ where: { id }, data });
    });
  }

  archiveById(id: string) {
    return this.prisma.financialAccount.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED', isDefault: false },
    });
  }
}
