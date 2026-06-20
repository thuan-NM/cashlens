import { Prisma } from '@prisma/client';
import { ListFinancialAccountsDto } from '../dto/list-financial-accounts.dto';

export const buildFinancialAccountWhere = (
  userId: string,
  query: ListFinancialAccountsDto,
): Prisma.FinancialAccountWhereInput => ({
  userId,
  deletedAt: null,
  status: query.status,
  type: query.type,
});
