import { Injectable } from '@nestjs/common';
import { ClassificationSource, Prisma, TransactionStatus } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { buildTransactionWhere } from './query/transactions.query';
import { transactionInclude } from './transactions.mapper';

@Injectable()
export class TransactionsRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByUser(userId: string, query: ListTransactionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = buildTransactionWhere(userId, query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: transactionInclude,
        orderBy: [{ transactionTime: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  findByIdForUser(userId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, userId, status: { not: 'DELETED' } },
      include: transactionInclude,
    });
  }

  create(data: Prisma.TransactionUncheckedCreateInput) {
    return this.prisma.transaction.create({
      data,
      include: transactionInclude,
    });
  }

  updateById(id: string, data: Prisma.TransactionUncheckedUpdateInput) {
    return this.prisma.transaction.update({
      where: { id },
      data,
      include: transactionInclude,
    });
  }

  updateCategory(id: string, categoryId?: string | null) {
    return this.prisma.transaction.update({
      where: { id },
      data: {
        categoryId: categoryId ?? null,
        classificationSource: ClassificationSource.MANUAL,
        classificationConfidence: categoryId ? 1 : null,
      },
      include: transactionInclude,
    });
  }

  markDuplicate(id: string, duplicateOfTransactionId?: string | null) {
    return this.prisma.transaction.update({
      where: { id },
      data: {
        isDuplicate: Boolean(duplicateOfTransactionId),
        duplicateOfTransactionId: duplicateOfTransactionId ?? null,
      },
      include: transactionInclude,
    });
  }

  updateStatus(id: string, status: TransactionStatus) {
    return this.prisma.transaction.update({
      where: { id },
      data: { status },
      include: transactionInclude,
    });
  }

  async financialAccountExists(userId: string, id: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    });

    return Boolean(account);
  }

  async categoryExistsForUser(userId: string, id: string) {
    const category = await this.prisma.transactionCategory.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        OR: [{ userId: null }, { userId }],
      },
      select: { id: true },
    });

    return Boolean(category);
  }

  async transactionExistsForUser(userId: string, id: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId, status: { not: 'DELETED' } },
      select: { id: true },
    });

    return Boolean(transaction);
  }
}
