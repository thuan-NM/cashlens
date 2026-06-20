import { Prisma, TransactionCategory } from '@prisma/client';
import { CreateTransactionCategoryDto } from './dto/create-transaction-category.dto';
import { UpdateTransactionCategoryDto } from './dto/update-transaction-category.dto';

const dateToIso = (value: Date) => value.toISOString();

export const toTransactionCategoryResponse = (
  category: TransactionCategory,
) => ({
  id: category.id,
  userId: category.userId,
  parentId: category.parentId,
  name: category.name,
  slug: category.slug,
  type: category.type,
  icon: category.icon,
  color: category.color,
  isSystem: category.isSystem,
  excludeFromBudget: category.excludeFromBudget,
  excludeFromAnalytics: category.excludeFromAnalytics,
  sortOrder: category.sortOrder,
  status: category.status,
  createdAt: dateToIso(category.createdAt),
  updatedAt: dateToIso(category.updatedAt),
});

export const slugifyTransactionCategory = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const toCreateTransactionCategoryInput = (
  userId: string,
  dto: CreateTransactionCategoryDto,
): Prisma.TransactionCategoryUncheckedCreateInput => ({
  userId,
  parentId: dto.parentId,
  name: dto.name,
  slug: slugifyTransactionCategory(dto.slug ?? dto.name),
  type: dto.type,
  icon: dto.icon,
  color: dto.color,
  excludeFromBudget: dto.excludeFromBudget,
  excludeFromAnalytics: dto.excludeFromAnalytics,
  sortOrder: dto.sortOrder,
});

export const toUpdateTransactionCategoryInput = (
  dto: UpdateTransactionCategoryDto,
): Prisma.TransactionCategoryUncheckedUpdateInput => {
  const slug = dto.slug ?? dto.name;

  return {
    parentId: dto.parentId,
    name: dto.name,
    slug: slug ? slugifyTransactionCategory(slug) : undefined,
    type: dto.type,
    icon: dto.icon,
    color: dto.color,
    excludeFromBudget: dto.excludeFromBudget,
    excludeFromAnalytics: dto.excludeFromAnalytics,
    sortOrder: dto.sortOrder,
    status: dto.status,
  };
};
