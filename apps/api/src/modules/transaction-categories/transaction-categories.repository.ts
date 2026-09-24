import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BaseRepository } from '../../common/repositories/base.repository';
import { nullIfNotFound } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTransactionCategoriesDto } from './dto/list-transaction-categories.dto';
import { buildTransactionCategoryWhere } from './query/transaction-categories.query';

@Injectable()
export class TransactionCategoriesRepository extends BaseRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  listByUser(userId: string, query: ListTransactionCategoriesDto) {
    return this.prisma.transactionCategory.findMany({
      where: buildTransactionCategoryWhere(userId, query),
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findAccessibleById(userId: string, id: string) {
    return this.prisma.transactionCategory.findFirst({
      where: {
        id,
        OR: [{ userId: null }, { userId }],
      },
    });
  }

  findOwnedById(userId: string, id: string) {
    return this.prisma.transactionCategory.findFirst({
      where: { id, userId },
    });
  }

  findByUserSlug(userId: string, slug: string) {
    return this.prisma.transactionCategory.findUnique({
      where: { userId_slug: { userId, slug } },
    });
  }

  create(data: Prisma.TransactionCategoryUncheckedCreateInput) {
    return this.prisma.transactionCategory.create({ data });
  }

  // Writes carry the owner predicate themselves (SEC-001): system categories
  // (userId null) and other users' categories resolve to null (not found).
  updateById(
    userId: string,
    id: string,
    data: Prisma.TransactionCategoryUncheckedUpdateInput,
  ) {
    return nullIfNotFound(
      this.prisma.transactionCategory.update({
        where: { id, userId },
        data,
      }),
    );
  }

  archiveById(userId: string, id: string) {
    return nullIfNotFound(
      this.prisma.transactionCategory.update({
        where: { id, userId },
        data: { status: 'ARCHIVED' },
      }),
    );
  }
}
