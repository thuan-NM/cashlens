import type { BaseRecord, CreateParams, CrudFilter, CustomParams, DataProvider, DeleteOneParams, GetListParams, GetOneParams, UpdateParams } from "@refinedev/core";
import { apiRequest, API_URL, toQueryString, type ApiListEnvelope } from "@/api/client";

type MethodWithBody = "post" | "put" | "patch";
type Method = "get" | "delete" | MethodWithBody;

const filterToQuery = (filters: CrudFilter[] = []) =>
  filters.reduce<Record<string, unknown>>((acc, filter) => {
    if ("field" in filter) acc[filter.field] = filter.value;
    return acc;
  }, {});

export const dataProvider: DataProvider = {
  getApiUrl: () => API_URL,

  getList: async <TData extends BaseRecord = BaseRecord>({ resource, pagination, filters, meta }: GetListParams) => {
    const current = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 25;
    const query = {
      ...filterToQuery(filters),
      ...(meta?.query as Record<string, unknown> | undefined),
      page: pagination?.mode === "off" ? undefined : current,
      limit: pagination?.mode === "off" ? undefined : pageSize,
    };
    const data = await apiRequest<TData[] | Partial<ApiListEnvelope<TData>>>(`/${resource}${toQueryString(query)}`);

    if (Array.isArray(data)) return { data, total: data.length };
    return {
      data: data.data ?? [],
      total: data.total ?? data.data?.length ?? 0,
    };
  },

  getOne: async <TData extends BaseRecord = BaseRecord>({ resource, id, meta }: GetOneParams) => {
    const data = await apiRequest<TData>(`/${resource}/${id}${toQueryString(meta?.query as Record<string, unknown> | undefined)}`);
    return { data };
  },

  create: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>({ resource, variables, meta }: CreateParams<TVariables>) => {
    const method = ((meta?.method as MethodWithBody | undefined) ?? "post").toUpperCase();
    const data = await apiRequest<TData>(`/${resource}`, {
      method,
      body: JSON.stringify(variables ?? {}),
    });
    return { data };
  },

  update: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>({ resource, id, variables, meta }: UpdateParams<TVariables>) => {
    const method = ((meta?.method as MethodWithBody | undefined) ?? "patch").toUpperCase();
    const data = await apiRequest<TData>(`/${resource}/${id}`, {
      method,
      body: JSON.stringify(variables ?? {}),
    });
    return { data };
  },

  deleteOne: async <TData extends BaseRecord = BaseRecord, TVariables = unknown>({ resource, id, variables }: DeleteOneParams<TVariables>) => {
    const data = await apiRequest<TData>(`/${resource}/${id}`, {
      method: "DELETE",
      body: variables ? JSON.stringify(variables) : undefined,
    });
    return { data };
  },

  custom: async <TData extends BaseRecord = BaseRecord, TQuery = unknown, TPayload = unknown>({ url, method = "get", payload, query, headers }: CustomParams<TQuery, TPayload>) => {
    const requestMethod = (method as Method).toUpperCase();
    const data = await apiRequest<TData>(`${url}${toQueryString(query as Record<string, unknown> | undefined)}`, {
      method: requestMethod,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { data };
  },
};