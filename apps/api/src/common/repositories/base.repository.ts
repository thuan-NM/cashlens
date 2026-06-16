import type {
  ListQuery,
  ListQueryConfig,
  ListResult,
} from '../types/list-query-config.type';
import { buildPrismaListArgs } from '../utils/prisma-list-query-builder';

interface PrismaListDelegate<TItem> {
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'>[];
    skip?: number;
    take?: number;
  }): Promise<TItem[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
}

interface PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>
  extends PrismaListDelegate<TItem> {
  findUnique(args: { where: Record<string, unknown> }): Promise<TItem | null>;
  findFirst(args: { where?: Record<string, unknown> }): Promise<TItem | null>;
  create(args: { data: TCreateInput }): Promise<TItem>;
  update(args: {
    where: Record<string, unknown>;
    data: TUpdateInput;
  }): Promise<TItem>;
  delete(args: { where: Record<string, unknown> }): Promise<TItem>;
}

interface ListOptions {
  where?: Record<string, unknown>;
}

export abstract class BaseRepository {
  protected async list<TItem>(
    delegate: PrismaListDelegate<TItem>,
    query: ListQuery,
    config: ListQueryConfig,
    options: ListOptions = {},
  ): Promise<ListResult<TItem>> {
    const args = buildPrismaListArgs(query, config);
    const where = this.mergeWhere(args.where, options.where);

    const [data, total] = await Promise.all([
      delegate.findMany({ ...args, where }),
      delegate.count({ where }),
    ]);

    return { data, total };
  }

  protected baseFindById<TItem, TCreateInput, TUpdateInput>(
    delegate: PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>,
    id: string,
  ): Promise<TItem | null> {
    return delegate.findUnique({
      where: { id },
    });
  }

  protected baseFindOne<TItem, TCreateInput, TUpdateInput>(
    delegate: PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>,
    where: Record<string, unknown>,
  ): Promise<TItem | null> {
    return delegate.findFirst({
      where,
    });
  }

  protected baseCreate<TItem, TCreateInput, TUpdateInput>(
    delegate: PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>,
    data: TCreateInput,
  ): Promise<TItem> {
    return delegate.create({
      data,
    });
  }

  protected baseUpdateById<TItem, TCreateInput, TUpdateInput>(
    delegate: PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>,
    id: string,
    data: TUpdateInput,
  ): Promise<TItem> {
    return delegate.update({
      where: { id },
      data,
    });
  }

  protected baseDeleteById<TItem, TCreateInput, TUpdateInput>(
    delegate: PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>,
    id: string,
  ): Promise<TItem> {
    return delegate.delete({
      where: { id },
    });
  }

  protected baseSoftDeleteById<TItem, TCreateInput, TUpdateInput>(
    delegate: PrismaCrudDelegate<TItem, TCreateInput, TUpdateInput>,
    id: string,
  ): Promise<TItem> {
    return delegate.update({
      where: { id },
      data: { deletedAt: new Date() } as TUpdateInput,
    });
  }

  private mergeWhere(
    queryWhere: Record<string, unknown>,
    baseWhere?: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!baseWhere || Object.keys(baseWhere).length === 0) {
      return queryWhere;
    }

    if (Object.keys(queryWhere).length === 0) {
      return baseWhere;
    }

    return {
      AND: [baseWhere, queryWhere],
    };
  }
}
