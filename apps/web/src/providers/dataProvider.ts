import type { DataProvider } from "@refinedev/core";
import { apiRequest, API_URL, toQueryString } from "@/api/client";

type MethodWithBody = "post" | "put" | "patch";
type Method = "get" | "delete" | MethodWithBody;

const filterToQuery = (filters: any[] = []) =>
  filters.reduce<Record<string, unknown>>((acc, filter) => {
    if ("field" in filter) acc[filter.field] = filter.value;
    return acc;
  }, {});

export const dataProvider: DataProvider = {
  getApiUrl: () => API_URL,

  getList: async ({ resource, pagination, filters, meta }) => {
    const current = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 25;
    const query = {
      ...filterToQuery(filters as any[]),
      ...(meta?.query as Record<string, unknown> | undefined),
      page: pagination?.mode === "off" ? undefined : current,
      limit: pagination?.mode === "off" ? undefined : pageSize,
    };
    const data = await apiRequest<any>(`/${resource}${toQueryString(query)}`);

    if (Array.isArray(data)) return { data, total: data.length };
    return {
      data: data.data ?? [],
      total: data.total ?? data.data?.length ?? 0,
    };
  },

  getOne: async ({ resource, id, meta }) => {
    const data = await apiRequest<any>(`/${resource}/${id}${toQueryString(meta?.query as Record<string, unknown> | undefined)}`);
    return { data };
  },

  create: async ({ resource, variables, meta }) => {
    const method = ((meta?.method as MethodWithBody | undefined) ?? "post").toUpperCase();
    const data = await apiRequest<any>(`/${resource}`, {
      method,
      body: JSON.stringify(variables ?? {}),
    });
    return { data };
  },

  update: async ({ resource, id, variables, meta }) => {
    const method = ((meta?.method as MethodWithBody | undefined) ?? "patch").toUpperCase();
    const data = await apiRequest<any>(`/${resource}/${id}`, {
      method,
      body: JSON.stringify(variables ?? {}),
    });
    return { data };
  },

  deleteOne: async ({ resource, id, variables }) => {
    const data = await apiRequest<any>(`/${resource}/${id}`, {
      method: "DELETE",
      body: variables ? JSON.stringify(variables) : undefined,
    });
    return { data };
  },

  custom: async ({ url, method = "get", payload, query, headers }) => {
    const requestMethod = (method as Method).toUpperCase();
    const data = await apiRequest<any>(`${url}${toQueryString(query as Record<string, unknown> | undefined)}`, {
      method: requestMethod,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { data };
  },
};