import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, mockApi, ok } from "@/test/api";
import { renderWithProviders, settle } from "@/test/render";
import { EmailPage } from "./components/EmailPage";
import type { EmailConnection, SyncRun } from "./sync-state";

const connection: EmailConnection = {
  id: "c1",
  provider: "GMAIL",
  emailAddress: "owner@example.test",
  status: "ACTIVE",
  lastSyncedAt: null,
  lastFailedAt: null,
  errorMessage: null,
  reconnectRequired: false,
  recoveryAction: "NONE",
  backfillFrom: "2026-06-01T00:00:00.000Z",
  backfillCompletedAt: null,
  syncInProgress: false,
};

const run = (id: string, overrides: Partial<SyncRun> = {}): SyncRun => ({
  id,
  status: "SUCCESS",
  startedAt: "2026-09-24T01:00:00.000Z",
  finishedAt: "2026-09-24T01:00:05.000Z",
  emailsFound: 50,
  emailsMatched: 40,
  emailsParsed: 38,
  emailsFailed: 2,
  transactionsCreated: 30,
  hasMore: false,
  errorMessage: null,
  ...overrides,
});

const emailApi = () =>
  mockApi().signedIn()
    .on("GET", "/email-connections", ok([connection]))
    .on("GET", "/email-listen-rules", ok([]))
    .on("GET", "/email-connections/c1/sync-runs", ok([]));

describe("EmailPage", () => {
  it("offers to continue a run that has more email, and continuing runs the next batch", async () => {
    const batches = [run("r1", { hasMore: true }), run("r2", { hasMore: false, emailsFound: 10 })];
    const api = emailApi().on("POST", "/email-connections/c1/sync", () => ok(batches.shift()));

    const { user } = renderWithProviders(<EmailPage />);
    await user.click(await screen.findByRole("button", { name: "Đồng bộ ngay" }));

    expect(await screen.findByText("Đã xử lý một phần: vẫn còn email chưa đồng bộ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tiếp tục đồng bộ" }));

    expect(await screen.findByText("Đồng bộ xong")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tiếp tục đồng bộ" })).not.toBeInTheDocument();
    expect(api.calls("POST", "/email-connections/c1/sync")).toHaveLength(2);
  });

  it("sends one sync request for a double click while a batch is running", async () => {
    const pending = deferred();
    const api = emailApi().on("POST", "/email-connections/c1/sync", () => pending.promise);

    const { user } = renderWithProviders(<EmailPage />);
    await user.dblClick(await screen.findByRole("button", { name: "Đồng bộ ngay" }));

    expect(await screen.findByRole("button", { name: "Đang đồng bộ..." })).toBeDisabled();
    await settle();
    expect(api.calls("POST", "/email-connections/c1/sync")).toHaveLength(1);

    await act(async () => pending.resolve(ok(run("r1"))));
    expect(await screen.findByText("Đồng bộ xong")).toBeInTheDocument();
    expect(api.calls("POST", "/email-connections/c1/sync")).toHaveLength(1);
  });

  it("explains a conflicting run and lets the user retry", async () => {
    let attempts = 0;
    const api = emailApi().on("POST", "/email-connections/c1/sync", () =>
      ++attempts === 1 ? fail(409, "Sync already running") : ok(run("r1")),
    );

    const { user } = renderWithProviders(<EmailPage />);
    await user.click(await screen.findByRole("button", { name: "Đồng bộ ngay" }));

    const notice = (await screen.findByText("Một lượt đồng bộ khác đang chạy")).closest(".ant-alert") as HTMLElement;
    await user.click(within(notice).getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByText("Đồng bộ xong")).toBeInTheDocument();
    expect(api.calls("POST", "/email-connections/c1/sync")).toHaveLength(2);
  });

  it("shows a load error for the connection with a retry", async () => {
    let attempts = 0;
    const api = mockApi().signedIn()
      .on("GET", "/email-connections", () => (++attempts === 1 ? fail(500, "boom") : ok([connection])))
      .on("GET", "/email-listen-rules", ok([]))
      .on("GET", "/email-connections/c1/sync-runs", ok([run("r0")]));

    const { user } = renderWithProviders(<EmailPage />);
    expect(await screen.findByText(/Không thể tải kết nối email\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByText("owner@example.test")).toBeInTheDocument();
    expect(await screen.findByText(/50 email · khớp 40/)).toBeInTheDocument();
    expect(api.calls("GET", "/email-connections")).toHaveLength(2);
  });

  it("sends one create request for a double-clicked listen-rule save", async () => {
    const pending = deferred();
    const api = emailApi().on("POST", "/email-listen-rules", () => pending.promise);

    const { user } = renderWithProviders(<EmailPage />);
    await user.click(await screen.findByRole("button", { name: /Thêm rule/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tên rule"), "VCB");
    await user.type(within(dialog).getByLabelText("Địa chỉ người gửi"), "no-reply@vcb.example.test");
    await user.dblClick(within(dialog).getByRole("button", { name: /Lưu rule|Đang lưu/ }));

    await waitFor(() => expect(api.calls("POST", "/email-listen-rules")).toHaveLength(1));
    // The second click of the double click is validated asynchronously too.
    await settle();
    expect(api.calls("POST", "/email-listen-rules")).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: /Lưu rule|Đang lưu/ }));
    await settle();
    expect(api.calls("POST", "/email-listen-rules")).toHaveLength(1);

    await act(async () => pending.resolve(ok({ id: "rule1", name: "VCB" }, 201)));
    await waitFor(() => expect(api.calls("GET", "/email-listen-rules").length).toBeGreaterThan(1));
    expect(api.calls("POST", "/email-listen-rules")).toHaveLength(1);
  });

  it("keeps the listen-rule dialog open with the API error when saving fails", async () => {
    const api = emailApi().on("POST", "/email-listen-rules", fail(400, ["senderEmail must be an email"]));

    const { user } = renderWithProviders(<EmailPage />);
    await user.click(await screen.findByRole("button", { name: /Thêm rule/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tên rule"), "VCB");
    await user.type(within(dialog).getByLabelText("Địa chỉ người gửi"), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Lưu rule" }));

    expect(await within(dialog).findByText("senderEmail must be an email")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByRole("button", { name: "Lưu rule" })).toBeEnabled();
    await settle();
    expect(api.calls("POST", "/email-listen-rules")).toHaveLength(1);
  });

  it("shows the outcome of the Gmail consent and clears it from the address", async () => {
    emailApi();
    renderWithProviders(<EmailPage />, { route: "/app/email?gmail=connected" });
    expect(await screen.findByText("Đã kết nối Gmail")).toBeInTheDocument();
  });

  it("explains a failed Gmail consent with a fixed message, never text from the address", async () => {
    emailApi();
    renderWithProviders(<EmailPage />, { route: "/app/email?gmail=failed&reason=STATE_INVALID" });
    expect(await screen.findByText("Không thể kết nối Gmail")).toBeInTheDocument();
    expect(screen.getByText("Phiên kết nối đã hết hạn hoặc không hợp lệ. Hãy kết nối lại.")).toBeInTheDocument();

    renderWithProviders(<EmailPage />, { route: "/app/email?gmail=failed&reason=%3Cb%3Einjected%3C%2Fb%3E" });
    expect(await screen.findAllByText("Không thể kết nối Gmail")).not.toHaveLength(0);
    expect(screen.queryByText(/injected/)).not.toBeInTheDocument();
  });

  it("disconnects Gmail after confirmation, with the action disabled while the request runs", async () => {
    const pending = deferred();
    let connected = true;
    const api = mockApi().signedIn()
      .on("GET", "/email-connections", () => ok(connected ? [connection] : []))
      .on("GET", "/email-listen-rules", ok([]))
      .on("GET", "/email-connections/c1/sync-runs", ok([]))
      .on("DELETE", "/email-connections/c1", () => pending.promise);

    const { user } = renderWithProviders(<EmailPage />);
    await user.click(await screen.findByRole("button", { name: "Ngắt kết nối" }));
    await user.click(await screen.findByRole("button", { name: "Ngắt kết nối Gmail" }));
    await settle();
    expect(api.calls("DELETE", "/email-connections/c1")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Đang ngắt kết nối..." })).toBeDisabled();

    connected = false;
    await act(async () => pending.resolve(ok({ id: "c1" })));
    expect(await screen.findByText("Đã ngắt kết nối Gmail")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Kết nối Gmail" })).toBeInTheDocument();
    expect(api.calls("DELETE", "/email-connections/c1")).toHaveLength(1);
  });

  it("saves the listen-rule switch, and restores it when saving fails", async () => {
    const rule = { id: "r1", name: "VCB", senderEmail: "notify@vcb.example.test", isEnabled: true };
    let stored = { ...rule };
    const api = mockApi().signedIn()
      .on("GET", "/email-connections", ok([connection]))
      .on("GET", "/email-listen-rules", () => ok([stored]))
      .on("GET", "/email-connections/c1/sync-runs", ok([]))
      .on("PATCH", "/email-listen-rules/r1", (request) => {
        const body = request.body as { isEnabled: boolean };
        if (api.calls("PATCH", "/email-listen-rules/r1").length > 1) return fail(500, "Internal server error");
        stored = { ...stored, isEnabled: body.isEnabled };
        return ok(stored);
      });

    const { user } = renderWithProviders(<EmailPage />);
    const toggle = await screen.findByRole("switch", { name: "Bật rule VCB" });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    await waitFor(() => expect(api.calls("PATCH", "/email-listen-rules/r1")).toHaveLength(1));
    expect(api.calls("PATCH", "/email-listen-rules/r1")[0].body).toEqual({ isEnabled: false });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Bật rule VCB" })).not.toBeChecked());

    await user.click(screen.getByRole("switch", { name: "Bật rule VCB" }));
    expect(await screen.findByText("Không thể lưu rule")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Bật rule VCB" })).not.toBeChecked());
  });
});
