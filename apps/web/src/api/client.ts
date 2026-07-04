export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
}

export interface ApiListEnvelope<T> {
  data: T[];
  total?: number;
  page?: number;
  limit?: number;
}

export const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const isEnvelope = <T>(value: unknown): value is ApiEnvelope<T> =>
  value !== null && typeof value === "object" && "success" in value && "data" in value;

export const unwrapApiData = <T>(value: unknown): T => {
  if (isEnvelope<T>(value)) return value.data;
  return value as T;
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message ?? response.statusText ?? "Request failed";
    throw new ApiError(Array.isArray(message) ? message.join(", ") : String(message), response.status, body);
  }

  return unwrapApiData<T>(body);
}

export const toQueryString = (params?: Record<string, unknown>) => {
  const search = new URLSearchParams();

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });

  const query = search.toString();
  return query ? `?${query}` : "";
};