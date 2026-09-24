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
  /** True when a 401 was answered by renewing the session without replaying the request. */
  sessionRenewed: boolean;

  constructor(message: string, status: number, body: unknown, sessionRenewed = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.sessionRenewed = sessionRenewed;
  }
}

// Session renewal (AUTH-002): on a 401, one shared refresh is attempted for all
// concurrent requests. Only safe requests are retried, once; a mutation is never
// replayed automatically, so it cannot run twice.
const AUTH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let refreshInFlight: Promise<boolean> | null = null;

const isAuthPath = (path: string) => AUTH_PATHS.some((authPath) => path.startsWith(authPath));

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
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

  const send = () =>
    fetch(url, {
      ...init,
      headers,
      credentials: "include",
    });
  let response = await send();
  let sessionRenewed = false;

  if (response.status === 401 && !isAuthPath(path.startsWith("/") ? path : `/${path}`)) {
    sessionRenewed = await refreshSession();
    if (sessionRenewed && SAFE_METHODS.has((init.method ?? "GET").toUpperCase())) {
      response = await send();
    }
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401 && sessionRenewed) {
      throw new ApiError("Your session was renewed. Please try again.", 401, body, true);
    }
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