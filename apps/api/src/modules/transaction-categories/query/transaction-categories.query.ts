import { Prisma } from '@prisma/client';
import { ListTransactionCategoriesDto } from '../dto/list-transaction-categories.dto';

export const buildTransactionCategoryWhere = (
  userId: string,
  query: ListTransactionCategoriesDto,
): Prisma.TransactionCategoryWhereInput => ({
  OR: [{ userId: null }, { userId }],
  type: query.type,
  status: query.status ?? 'ACTIVE',
});
