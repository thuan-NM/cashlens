import { vi } from "vitest";
import { API_URL } from "@/api/client";

/** One request the page sent, as the fake API saw it. */
export type RecordedRequest = {
  method: string;
  /** The API path without the `/api` base, e.g. `/goals/g1/simulation`. */
  path: string;
  query: URLSearchParams;
  body: unknown;
};

export type Reply = { status?: number; body?: unknown };
export type Handler = (request: RecordedRequest) => Reply | Promise<Reply>;

/** The API success envelope (`{success, data, message, timestamp}`). */
export const ok = (data: unknown, status = 200): Reply => ({
  status,
  body: { success: true, data, timestamp: "2026-09-24T00:00:00.000Z" },
});

/** An API error body, as the Nest API sends it. */
export const fail = (status: number, message: string | string[], extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: { statusCode: status, message, ...extra },
});

/** A reply the test settles later, to hold a request in flight. */
export function deferred() {
  let settle!: (reply: Reply) => void;
  const promise = new Promise<Reply>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

/** The signed-in user a page test's session check answers with. */
export const testUser = { id: "u1", email: "owner@example.test", fullName: "Owner" };

const apiBase = new URL(API_URL);

/** Fakes created by the running test; `setup.ts` fails the test if one saw an unmocked request. */
export const activeApis: Array<{ unhandled: string[] }> = [];

/**
 * A fetch-level fake of the CashLens API. Routes are matched by method and exact
 * path (or a RegExp); the most recently added route wins, so a test can override
 * one mid-way. A request no route handles is answered with 501 and recorded in
 * `unhandled`, which fails the test in `afterEach` (`setup.ts`).
 */
export function mockApi() {
  const routes: Array<{ method: string; path: string | RegExp; handler: Handler }> = [];
  const log: RecordedRequest[] = [];
  const unhandled: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== apiBase.origin || !url.pathname.startsWith(apiBase.pathname)) {
      unhandled.push(`${init?.method ?? "GET"} ${url.href} (outside the API)`);
      throw new TypeError("Failed to fetch");
    }
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice(apiBase.pathname.length) || "/";
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const request: RecordedRequest = { method, path, query: url.searchParams, body: rawBody ? JSON.parse(rawBody) : undefined };
    log.push(request);

    const route = [...routes]
      .reverse()
      .find((item) => item.method === method && (typeof item.path === "string" ? item.path === path : item.path.test(path)));
    if (!route) {
      unhandled.push(`${method} ${path}${url.search}`);
      return new Response(JSON.stringify({ statusCode: 501, message: "Not mocked in this test" }), { status: 501 });
    }
    const reply = await route.handler(request);
    const status = reply.status ?? 200;
    const text = reply.body === undefined ? "" : JSON.stringify(reply.body);
    return new Response(status === 204 ? null : text, { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const api = {
    log,
    unhandled,
    /** Answers `method path` with a fixed reply, or a handler's reply. */
    on(method: string, path: string | RegExp, reply: Reply | Handler) {
      routes.push({ method: method.toUpperCase(), path, handler: typeof reply === "function" ? reply : () => reply });
      return api;
    },
    /**
     * Answers the session check (`GET /auth/me`) that refine's route-change handler
     * sends through the auth provider whenever a page mounts, as for a signed-in user.
     */
    signedIn(user: unknown = testUser) {
      return api.on("GET", "/auth/me", ok(user));
    },
    /** The requests sent to `method path`. */
    calls(method: string, path: string | RegExp) {
      return log.filter(
        (request) => request.method === method.toUpperCase() && (typeof path === "string" ? request.path === path : path.test(request.path)),
      );
    },
    expectAllHandled() {
      if (unhandled.length) throw new Error(`Requests without a mocked route:\n${unhandled.join("\n")}`);
    },
  };
  activeApis.push(api);
  return api;
}

export type MockApi = ReturnType<typeof mockApi>;
