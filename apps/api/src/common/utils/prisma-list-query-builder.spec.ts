import { BadRequestException } from '@nestjs/common';
import type { ListQueryConfig } from '../types/list-query-config.type';
import { buildPrismaListArgs } from './prisma-list-query-builder';

const config: ListQueryConfig = {
  name: { type: 'string', filterable: true, searchable: true },
  createdAt: { type: 'date', filterable: true },
};

const whereFor = (operator: string, value: unknown, field = 'name') =>
  buildPrismaListArgs(
    { filters: [{ field, operator, value }] } as never,
    config,
  ).where;

describe('buildPrismaListArgs filter values', () => {
  it('uses text, numbers, and booleans as text', () => {
    expect(whereFor('contains', 'abc')).toEqual({
      AND: [{ name: { contains: 'abc', mode: 'insensitive' } }],
    });
    expect(whereFor('startswith', 42)).toEqual({
      AND: [{ name: { startsWith: '42', mode: 'insensitive' } }],
    });
    expect(whereFor('endswith', undefined)).toEqual({
      AND: [{ name: { endsWith: '', mode: 'insensitive' } }],
    });
    expect(whereFor('in', 'a,b')).toEqual({
      AND: [{ name: { in: ['a', 'b'] } }],
    });
  });

  it('refuses an object value instead of searching for "[object Object]"', () => {
    for (const operator of ['contains', 'startswith', 'endswith', 'in']) {
      expect(() => whereFor(operator, { a: 1 })).toThrow(BadRequestException);
    }
    expect(() => whereFor('eq', { a: 1 }, 'createdAt')).toThrow(
      BadRequestException,
    );
  });
});
