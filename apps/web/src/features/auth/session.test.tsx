import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "@/App";
import { ApiError, apiRequest } from "@/api/client";
import { describeApiError } from "@/api/mappers";
import { authProvider } from "@/providers/authProvider";
import { deferred, fail, mockApi, ok, type MockApi } from "@/test/api";

const user = { id: "u1", email: "owner@example.test", fullName: "Owner" };

/** The requests the signed-in shell and the Alerts page make. */
const withAlertsPage = (api: MockApi) =>
  api
    .on("GET", "/alerts", ok({ data: [], total: 0, page: 1, limit: 50 }))
    .on("GET", "/alerts/unread-count", ok({ count: 0 }))
    .on("GET", "/alerts/settings", ok([]));

const signInScreen = () => screen.findByText("Chào mừng trở lại");

describe("session renewal (api/client.ts)", () => {
  it("renews once for concurrent 401s and replays each safe request once", async () => {
    const refresh = deferred();
    let goalsCalls = 0;
    const api = mockApi()
      .on("GET", "/goals", () => (++goalsCalls <= 2 ? fail(401, "Unauthorized") : ok([{ id: "g1" }])))
      .on("POST", "/auth/refresh", () => refresh.promise);

    const both = Promise.all([apiRequest("/goals"), apiRequest("/goals")]);
    await waitFor(() => expect(api.calls("POST", "/auth/refresh")).toHaveLength(1));
    refresh.resolve(ok({ ok: true }));

    await expect(both).resolves.toEqual([[{ id: "g1" }], [{ id: "g1" }]]);
    expect(api.calls("POST", "/auth/refresh")).toHaveLength(1);
    expect(api.calls("GET", "/goals")).toHaveLength(4);
  });

  it("never replays a mutation after renewing, and asks the user to try again", async () => {
    const api = mockApi()
      .on("POST", "/transactions", fail(401, "Unauthorized"))
      .on("POST", "/auth/refresh", ok({ ok: true }));

    const error = await apiRequest("/transactions", { method: "POST", body: "{}" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, sessionRenewed: true });
    expect(describeApiError(error)).toBe("Phiên đăng nhập vừa được gia hạn. Vui lòng thử lại.");
    expect(api.calls("POST", "/transactions")).toHaveLength(1);
    // Renewed: refine keeps the user signed in.
    await expect(authProvider.onError?.(error)).resolves.not.toHaveProperty("logout");
  });

  it("signs out when the renewal fails", async () => {
    const api = mockApi().on("GET", "/goals", fail(401, "Unauthorized")).on("POST", "/auth/refresh", fail(401, "Unauthorized"));

    const error = await apiRequest("/goals").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 401, sessionRenewed: false });
    expect(api.calls("GET", "/goals")).toHaveLength(1);
    await expect(authProvider.onError?.(error)).resolves.toMatchObject({ logout: true, redirectTo: "/" });
  });

  it("does not try to renew a failed sign-in", async () => {
    const api = mockApi().on("POST", "/auth/login", fail(401, "Invalid credentials"));
    await expect(apiRequest("/auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 401 });
    expect(api.calls("POST", "/auth/refresh")).toHaveLength(0);
  });
});

describe("authentication transitions (App)", () => {
  it("returns to sign-in when the session cannot be renewed on load", async () => {
    const api = mockApi().on("GET", "/auth/me", fail(401, "Unauthorized")).on("POST", "/auth/refresh", fail(401, "Unauthorized"));
    window.history.replaceState({}, "", "/app/alerts");

    render(<App />);

    expect(await signInScreen()).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(api.calls("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("stays on the page when the session is renewed on load", async () => {
    let meCalls = 0;
    const api = withAlertsPage(mockApi())
      .on("GET", "/auth/me", () => (++meCalls === 1 ? fail(401, "Unauthorized") : ok(user)))
      .on("POST", "/auth/refresh", ok({ ok: true }));
    window.history.replaceState({}, "", "/app/alerts");

    render(<App />);

    expect(await screen.findByText("Không có cảnh báo đang mở.")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/alerts");
    expect(api.calls("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("signs out with one logout request and clears the session even if the server fails", async () => {
    const api = withAlertsPage(mockApi()).on("GET", "/auth/me", ok(user)).on("POST", "/auth/logout", fail(500, "boom"));
    window.history.replaceState({}, "", "/app/alerts");

    render(<App />);
    await screen.findByText("Không có cảnh báo đang mở.");
    await userEvent.setup().click(screen.getByTitle("Đăng xuất"));

    expect(await signInScreen()).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(api.calls("POST", "/auth/logout")).toHaveLength(1);
  });

  it("returns to sign-in when the session expires mid-session and cannot be renewed", async () => {
    const api = withAlertsPage(mockApi())
      .on("GET", "/auth/me", ok(user))
      .on("POST", "/auth/refresh", fail(401, "Unauthorized"))
      .on("POST", "/auth/logout", ok(null));
    window.history.replaceState({}, "", "/app/alerts");

    render(<App />);
    await screen.findByText("Không có cảnh báo đang mở.");

    // The session expires: every data request now answers 401 and renewal fails.
    api.on("GET", /^\/alerts/, fail(401, "Unauthorized"));
    window.dispatchEvent(new Event("cashlens:alerts-changed"));

    // React Query's default retries (with backoff) run before refine reports the error.
    expect(await screen.findByText("Chào mừng trở lại", {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(api.calls("POST", "/auth/logout").length).toBeGreaterThanOrEqual(1);
  }, 30_000);
  it("never shows the previous user's data to the next user who signs in in the same tab", async () => {
    const userA = { id: "uA", email: "a@example.test", fullName: "User A" };
    const userB = { id: "uB", email: "b@example.test", fullName: "User B" };
    const goalOf = (id: string, name: string) => ({ id, name, type: "SAVING", targetAmount: 12_000_000, savedAmount: 2_000_000, remainingAmount: 10_000_000, targetDate: null, months: 6, currency: "VND" });
    let current: typeof userA | null = userA;
    const api = withAlertsPage(mockApi())
      .on("GET", "/auth/me", () => (current ? ok(current) : fail(401, "Unauthorized")))
      .on("POST", "/auth/refresh", fail(401, "Unauthorized"))
      .on("POST", "/auth/logout", () => {
        current = null;
        return ok(null);
      })
      .on("POST", "/auth/login", () => {
        current = userB;
        return ok({ user: userB });
      })
      .on("GET", "/dashboard/overview", ok({ month: "2026-09", currency: "VND", timeZone: "Asia/Ho_Chi_Minh", periodStart: "2026-09-01", periodEnd: "2026-09-30", income: 0, expense: 0, netCashflow: 0, transactionCount: 0, currencies: [] }))
      .on("GET", /^\/dashboard\/(cashflow|category-breakdown|recent-transactions|hot-budgets|insights)$/, ok([]))
      .on("GET", "/goals", ok([goalOf("gA", "Quỹ riêng của A")]))
      .on("GET", /^\/goals\/[^/]+\/simulation$/, fail(404, "Goal not found"));
    window.history.replaceState({}, "", "/app/goals");

    render(<App />);
    const user = userEvent.setup();
    expect((await screen.findAllByText(/Quỹ riêng của A/)).length).toBeGreaterThan(0);

    await user.click(screen.getByTitle("Đăng xuất"));
    await signInScreen();
    // From here on, any render of A's goal anywhere in the page is a leak.
    let leaked = false;
    const watch = new MutationObserver(() => {
      if (document.body.textContent?.includes("Quỹ riêng của A")) leaked = true;
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    const goalsCallsBeforeB = api.calls("GET", "/goals").length;

    await user.type(screen.getByLabelText("Email"), userB.email);
    await user.type(screen.getByLabelText("Mật khẩu"), "secret-b");
    await user.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await waitFor(() => expect(window.location.pathname).toBe("/app/dashboard"));
    expect(api.calls("GET", "/goals")).toHaveLength(goalsCallsBeforeB);

    // B opens Goals while B's list is still in flight.
    const goalsOfB = deferred();
    api.on("GET", "/goals", () => goalsOfB.promise);
    await screen.findByTitle("Đăng xuất");
    await user.click(document.querySelector<HTMLAnchorElement>('a[href="/app/goals"]')!);
    await waitFor(() => expect(window.location.pathname).toBe("/app/goals"));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryAllByText(/Quỹ riêng của A/)).toHaveLength(0);
    expect(leaked).toBe(false);
    await waitFor(() => expect(api.calls("GET", "/goals")).toHaveLength(goalsCallsBeforeB + 1));

    goalsOfB.resolve(ok([goalOf("gB", "Quỹ của B")]));
    expect((await screen.findAllByText(/Quỹ của B/)).length).toBeGreaterThan(0);
    watch.disconnect();
    expect(leaked).toBe(false);
  });
});
