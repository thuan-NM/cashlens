import { Injectable } from '@nestjs/common';
import { Prisma, TransactionDirection } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ListBudgetsDto } from './dto/list-budgets.dto';
import { buildBudgetWhere } from './query/budgets.query';

const budgetInclude = {
  category: true,
} satisfies Prisma.BudgetInclude;

@Injectable()
export class BudgetsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string, query: ListBudgetsDto) {
    return this.prisma.budget.findMany({
      where: buildBudgetWhere(userId, query),
      include: budgetInclude,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.budget.findFirst({
      where: { id, userId, deletedAt: null },
      include: budgetInclude,
    });
  }

  create(data: Prisma.BudgetUncheckedCreateInput) {
    return this.prisma.budget.create({ data, include: budgetInclude });
  }

  updateById(id: string, data: Prisma.BudgetUncheckedUpdateInput) {
    return this.prisma.budget.update({
      where: { id },
      data,
      include: budgetInclude,
    });
  }

  archiveById(id: string) {
    return this.prisma.budget.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  categoryExistsForUser(userId: string, categoryId: string) {
    return this.prisma.transactionCategory.findFirst({
      where: {
        id: categoryId,
        status: 'ACTIVE',
        excludeFromBudget: false,
        OR: [{ userId: null }, { userId }],
      },
      select: { id: true },
    });
  }

  async spentByCategory(
    userId: string,
    categoryIds: string[],
    range: { from: Date; to: Date },
  ) {
    if (categoryIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        categoryId: { in: categoryIds },
        direction: TransactionDirection.EXPENSE,
        status: 'POSTED',
        isDuplicate: false,
        transactionTime: { gte: range.from, lt: range.to },
      },
      _sum: { amount: true },
    });

    return new Map(
      rows.map((row) => [
        row.categoryId ?? '',
        Number(row._sum.amount?.toString() ?? 0),
      ]),
    );
  }
}
