import { BadRequestException } from '@nestjs/common';
import type {
  FilterOperator,
  ListFieldConfig,
  ListQuery,
  ListQueryConfig,
} from '../types/list-query-config.type';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const DEFAULT_OPERATORS: Record<ListFieldConfig['type'], FilterOperator[]> = {
  string: ['eq', 'ne', 'contains', 'startswith', 'endswith', 'in', 'nin', 'null', 'nnull'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'null', 'nnull'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'null', 'nnull'],
  boolean: ['eq', 'ne', 'null', 'nnull'],
  enum: ['eq', 'ne', 'in', 'nin', 'null', 'nnull'],
};

export interface PrismaListArgs {
  where: Record<string, unknown>;
  orderBy: Record<string, 'asc' | 'desc'>[];
  skip: number;
  take: number;
}

export function buildPrismaListArgs(
  query: ListQuery,
  config: ListQueryConfig,
): PrismaListArgs {
  const currentPage = Math.max(query.currentPage ?? DEFAULT_PAGE, 1);
  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  return {
    where: buildWhere(query, config),
    orderBy: buildOrderBy(query, config),
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
  };
}

function buildWhere(
  query: ListQuery,
  config: ListQueryConfig,
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  if (query.search?.trim()) {
    const search = query.search.trim();
    const searchableFields = Object.entries(config).filter(
      ([, fieldConfig]) => fieldConfig.searchable && fieldConfig.type === 'string',
    );

    if (searchableFields.length > 0) {
      and.push({
        OR: searchableFields.map(([field]) => ({
          [field]: { contains: search, mode: 'insensitive' },
        })),
      });
    }
  }

  for (const filter of query.filters ?? []) {
    const fieldConfig = getFieldConfig(config, filter.field);

    if (!fieldConfig.filterable) {
      throw new BadRequestException(`Field "${filter.field}" is not filterable`);
    }

    validateOperator(filter.operator, fieldConfig, filter.field);
    and.push({ [filter.field]: buildFilterValue(filter.operator, filter.value, fieldConfig) });
  }

  return and.length > 0 ? { AND: and } : {};
}

function buildOrderBy(
  query: ListQuery,
  config: ListQueryConfig,
): Record<string, 'asc' | 'desc'>[] {
  return (query.sorters ?? []).map((sorter) => {
    const fieldConfig = getFieldConfig(config, sorter.field);

    if (!fieldConfig.sortable) {
      throw new BadRequestException(`Field "${sorter.field}" is not sortable`);
    }

    return { [sorter.field]: sorter.order };
  });
}

function getFieldConfig(config: ListQueryConfig, field: string): ListFieldConfig {
  const fieldConfig = config[field];

  if (!fieldConfig) {
    throw new BadRequestException(`Field "${field}" is not allowed`);
  }

  return fieldConfig;
}

function validateOperator(
  operator: FilterOperator,
  fieldConfig: ListFieldConfig,
  field: string,
) {
  const allowedOperators = fieldConfig.operators ?? DEFAULT_OPERATORS[fieldConfig.type];

  if (!allowedOperators.includes(operator)) {
    throw new BadRequestException(
      `Operator "${operator}" is not allowed for field "${field}"`,
    );
  }
}

function buildFilterValue(
  operator: FilterOperator,
  value: unknown,
  fieldConfig: ListFieldConfig,
): unknown {
  switch (operator) {
    case 'eq':
      return normalizeValue(value, fieldConfig);
    case 'ne':
      return { not: normalizeValue(value, fieldConfig) };
    case 'contains':
      return { contains: String(value ?? ''), mode: 'insensitive' };
    case 'startswith':
      return { startsWith: String(value ?? ''), mode: 'insensitive' };
    case 'endswith':
      return { endsWith: String(value ?? ''), mode: 'insensitive' };
    case 'in':
      return { in: normalizeArray(value, fieldConfig) };
    case 'nin':
      return { notIn: normalizeArray(value, fieldConfig) };
    case 'gt':
      return { gt: normalizeValue(value, fieldConfig) };
    case 'gte':
      return { gte: normalizeValue(value, fieldConfig) };
    case 'lt':
      return { lt: normalizeValue(value, fieldConfig) };
    case 'lte':
      return { lte: normalizeValue(value, fieldConfig) };
    case 'null':
      return null;
    case 'nnull':
      return { not: null };
  }
}

function normalizeArray(value: unknown, fieldConfig: ListFieldConfig): unknown[] {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return values.map((item) => normalizeValue(item, fieldConfig));
}

function normalizeValue(value: unknown, fieldConfig: ListFieldConfig): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (fieldConfig.type === 'number') {
    const numberValue = Number(value);

    if (Number.isNaN(numberValue)) {
      throw new BadRequestException('Expected a number filter value');
    }

    return numberValue;
  }

  if (fieldConfig.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException('Expected a boolean filter value');
  }

  if (fieldConfig.type === 'date') {
    const date = new Date(String(value));

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Expected a valid date filter value');
    }

    return date;
  }

  return value;
}
