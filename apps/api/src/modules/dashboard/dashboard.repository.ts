import { Injectable } from '@nestjs/common';
import { TransactionDirection } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  sumAmount(
    userId: string,
    range: { from: Date; to: Date },
    directions: TransactionDirection[],
  ) {
    return this.prisma.transaction.aggregate({
      where: {
        userId,
        status: 'POSTED',
        isDuplicate: false,
        direction: { in: directions },
        transactionTime: { gte: range.from, lt: range.to },
      },
      _sum: { amount: true },
    });
  }

  countTransactions(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.count({
      where: {
        userId,
        status: 'POSTED',
        isDuplicate: false,
        transactionTime: { gte: range.from, lt: range.to },
      },
    });
  }

  recentTransactions(
    userId: string,
    range: { from: Date; to: Date },
    limit = 5,
  ) {
    return this.prisma.transaction.findMany({
      where: {
        userId,
        status: 'POSTED',
        isDuplicate: false,
        transactionTime: { gte: range.from, lt: range.to },
      },
      include: { account: true, category: true },
      orderBy: [{ transactionTime: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  cashflowTransactions(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.findMany({
      where: {
        userId,
        status: 'POSTED',
        isDuplicate: false,
        transactionTime: { gte: range.from, lt: range.to },
      },
      select: { amount: true, direction: true, transactionTime: true },
      orderBy: [{ transactionTime: 'asc' }],
    });
  }

  categoryBreakdown(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        status: 'POSTED',
        isDuplicate: false,
        direction: TransactionDirection.EXPENSE,
        transactionTime: { gte: range.from, lt: range.to },
        category: { excludeFromAnalytics: false },
      },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    });
  }

  categories(ids: string[]) {
    return this.prisma.transactionCategory.findMany({
      where: { id: { in: ids } },
    });
  }

  activeBudgets(userId: string, range: { from: Date; to: Date }) {
    return this.prisma.budget.findMany({
      where: {
        userId,
        deletedAt: null,
        isActive: true,
        startsAt: { lt: range.to },
        OR: [{ endsAt: null }, { endsAt: { gte: range.from } }],
      },
      include: { category: true },
    });
  }

  budgetSpending(
    userId: string,
    categoryIds: string[],
    range: { from: Date; to: Date },
  ) {
    return this.prisma.transaction.groupBy({
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
  }

  unreadCriticalAlerts(userId: string) {
    return this.prisma.alert.count({
      where: {
        userId,
        isRead: false,
        severity: { in: ['WARNING', 'CRITICAL'] },
      },
    });
  }
}
