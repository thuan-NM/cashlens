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
});
