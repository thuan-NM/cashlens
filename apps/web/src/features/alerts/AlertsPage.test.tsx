import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, mockApi, ok, type RecordedRequest } from "@/test/api";
import { renderWithProviders } from "@/test/render";
import type { ApiAlert } from "@/types/alert";
import { AlertsPage } from "./components/AlertsPage";

const alert = (id: string, overrides: Partial<ApiAlert> = {}): ApiAlert => ({
  id,
  type: "BUDGET_THRESHOLD",
  severity: "WARNING",
  title: `Cảnh báo ${id}`,
  message: "Chi tiêu gần hạn mức",
  isRead: false,
  status: "ACTIVE",
  triggeredAt: "2026-09-20T03:00:00.000Z",
  emailDelivery: null,
  ...overrides,
});

/** A fake alerts API that keeps read state and lifecycle status separately, like the real one. */
function alertsApi(initial: ApiAlert[]) {
  const alerts = new Map(initial.map((item) => [item.id, { ...item }]));
  const api = mockApi().signedIn()
    .on("GET", "/alerts", ({ query }: RecordedRequest) => {
      const status = query.get("status");
      const data = [...alerts.values()].filter((item) => !status || item.status === status);
      return ok({ data, total: data.length, page: 1, limit: 50 });
    })
    .on("GET", "/alerts/unread-count", () => ok({ count: [...alerts.values()].filter((item) => !item.isRead).length }))
    .on("GET", "/alerts/settings", ok([{ type: "BUDGET_THRESHOLD", inAppEnabled: true, emailEnabled: false, emailAvailable: true }]))
    .on("PATCH", /^\/alerts\/[^/]+\/read$/, ({ path }) => {
      const item = alerts.get(path.split("/")[2])!;
      item.isRead = true;
      return ok(item);
    })
    .on("PATCH", /^\/alerts\/[^/]+\/dismiss$/, ({ path }) => {
      const item = alerts.get(path.split("/")[2])!;
      item.status = "DISMISSED";
      item.dismissedAt = "2026-09-24T00:00:00.000Z";
      return ok(item);
    });
  return { api, alerts };
}

const card = (id: string) => screen.getByTestId(`alert-${id}`);

describe("AlertsPage", () => {
  it("shows a loading state, then an error with a retry", async () => {
    const first = deferred();
    let attempts = 0;
    const { api } = alertsApi([alert("a1")]);
    api.on("GET", "/alerts", () => (++attempts === 1 ? first.promise : ok({ data: [alert("a1")], total: 1 })));

    const { container, user } = renderWithProviders(<AlertsPage />);
    await waitFor(() => expect(container.querySelector(".ant-skeleton")).not.toBeNull());

    await act(async () => first.resolve(fail(500, "boom")));
    expect(await screen.findByText(/Không thể tải cảnh báo\. Dịch vụ tạm thời không khả dụng/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Cảnh báo a1")).toBeInTheDocument();
    expect(api.calls("GET", "/alerts")).toHaveLength(2);
  });

  it("filters by lifecycle status and shows an empty state per status", async () => {
    const { api } = alertsApi([alert("open"), alert("done", { status: "RESOLVED", isRead: true, resolutionReason: "PERIOD_ENDED" })]);

    const { user } = renderWithProviders(<AlertsPage />);

    expect(await screen.findByText("Cảnh báo open")).toBeInTheDocument();
    expect(screen.queryByText("Cảnh báo done")).not.toBeInTheDocument();
    expect(api.calls("GET", "/alerts")[0].query.get("status")).toBe("ACTIVE");

    await user.click(screen.getByText("Đã xử lý", { selector: ".ant-segmented-item-label" }));
    expect(await screen.findByText("Cảnh báo done")).toBeInTheDocument();
    expect(screen.getByText(/Đã tự động xử lý: kỳ ngân sách đã kết thúc/)).toBeInTheDocument();

    await user.click(screen.getByText("Đã ẩn", { selector: ".ant-segmented-item-label" }));
    expect(await screen.findByText("Không có cảnh báo nào ở trạng thái này.")).toBeInTheDocument();
  });

  it("marking an alert read changes only the read state, not its lifecycle status", async () => {
    const { api } = alertsApi([alert("a1")]);

    const { user } = renderWithProviders(<AlertsPage />);
    await screen.findByText("Cảnh báo a1");
    expect(screen.getByTestId("unread-count")).toHaveTextContent("1");

    await user.click(within(card("a1")).getByRole("button", { name: "Đánh dấu đã đọc" }));

    await waitFor(() => expect(within(card("a1")).queryByRole("button", { name: "Đánh dấu đã đọc" })).not.toBeInTheDocument());
    expect(within(card("a1")).getByLabelText("Đã đọc")).toBeInTheDocument();
    // Still ACTIVE: it stays in the open list and can still be dismissed.
    expect(within(card("a1")).getByTestId("alert-status")).toHaveTextContent("Đang mở");
    expect(within(card("a1")).getByRole("button", { name: "Ẩn" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("unread-count")).toHaveTextContent("0"));
    expect(api.calls("PATCH", "/alerts/a1/read")).toHaveLength(1);
    expect(api.calls("PATCH", "/alerts/a1/dismiss")).toHaveLength(0);
  });

  it("dismisses with exactly one PATCH /alerts/:id/dismiss, even on a double click", async () => {
    const { api, alerts } = alertsApi([alert("a1"), alert("a2")]);
    const pending = deferred();
    api.on("PATCH", "/alerts/a1/dismiss", async () => {
      const reply = await pending.promise;
      alerts.get("a1")!.status = "DISMISSED";
      return reply;
    });

    const { user } = renderWithProviders(<AlertsPage />);
    await screen.findByText("Cảnh báo a1");

    await user.dblClick(within(card("a1")).getByRole("button", { name: "Ẩn" }));
    // While in flight every alert action is disabled.
    expect(within(card("a2")).getByRole("button", { name: "Ẩn" })).toBeDisabled();
    expect(api.calls("PATCH", "/alerts/a1/dismiss")).toHaveLength(1);

    await act(async () => pending.resolve(ok({ ...alert("a1"), status: "DISMISSED" })));
    await waitFor(() => expect(screen.queryByText("Cảnh báo a1")).not.toBeInTheDocument());
    expect(api.calls("PATCH", "/alerts/a1/dismiss")).toHaveLength(1);
    expect(api.calls("PATCH", /\/read$/)).toHaveLength(0);
  });

  it("a retry after a failed dismiss does not repeat an earlier successful mark-read", async () => {
    const { api } = alertsApi([alert("a1")]);
    let dismissAttempts = 0;
    api.on("PATCH", "/alerts/a1/dismiss", () => {
      dismissAttempts += 1;
      return dismissAttempts === 1 ? fail(503, "unavailable") : ok({ ...alert("a1"), status: "DISMISSED" });
    });

    const { user } = renderWithProviders(<AlertsPage />);
    await screen.findByText("Cảnh báo a1");

    await user.click(within(card("a1")).getByRole("button", { name: "Đánh dấu đã đọc" }));
    await waitFor(() => expect(within(card("a1")).getByLabelText("Đã đọc")).toBeInTheDocument());

    await user.click(within(card("a1")).getByRole("button", { name: "Ẩn" }));
    expect(await screen.findByText("Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.")).toBeInTheDocument();
    await waitFor(() => expect(within(card("a1")).getByRole("button", { name: "Ẩn" })).toBeEnabled());

    await user.click(within(card("a1")).getByRole("button", { name: "Ẩn" }));
    await waitFor(() => expect(api.calls("PATCH", "/alerts/a1/dismiss")).toHaveLength(2));
    expect(api.calls("PATCH", "/alerts/a1/read")).toHaveLength(1);
  });
});
