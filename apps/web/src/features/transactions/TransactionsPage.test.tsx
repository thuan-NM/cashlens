import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TransactionPayload } from "@/api/mappers";
import { deferred, fail, mockApi, ok, type Reply } from "@/test/api";
import { renderWithProviders, settle } from "@/test/render";
import { TransactionsPage } from "./components/TransactionsPage";

const categories = [
  { id: "food", name: "Ăn uống", type: "EXPENSE", color: "#d97757" },
  { id: "fun", name: "Giải trí", type: "EXPENSE", color: "#5b8def" },
];

const tx = (id: string, overrides: Partial<TransactionPayload> = {}): TransactionPayload => ({
  id,
  amount: 45_000,
  currency: "VND",
  direction: "EXPENSE",
  status: "POSTED",
  isDuplicate: false,
  categoryId: "food",
  category: { name: "Ăn uống", color: "#d97757" },
  classificationSource: "SYSTEM_RULE",
  transactionTime: "2026-09-20T05:00:00.000Z",
  userNote: "",
  description: `Giao dịch ${id}`,
  merchantName: "Quán",
  sourceType: "MANUAL",
  ...overrides,
});

const listReply = (rows: TransactionPayload[]): Reply =>
  ok({
    data: rows,
    total: rows.length,
    page: 1,
    limit: 50,
    totals: { currency: "VND", income: 0, expense: 45_000, netCashflow: -45_000, transactionCount: rows.length, currencies: [] },
  });

/** A fake transactions API whose rows follow the mutations the page sends. */
function transactionsApi(initial: TransactionPayload[]) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const api = mockApi().signedIn()
    .on(
      "GET",
      "/dashboard/overview",
      ok({ month: "2026-09", currency: "VND", periodStart: "2026-09-01", periodEnd: "2026-09-30", timeZone: "Asia/Ho_Chi_Minh" }),
    )
    .on("GET", "/transaction-categories", ok(categories))
    .on("GET", "/transactions", () => listReply([...rows.values()]))
    .on("GET", /^\/transactions\/[^/]+\/category-history$/, ok([]))
    .on("PATCH", /^\/transactions\/[^/]+\/category$/, ({ path, body }) => {
      const row = rows.get(path.split("/")[2])!;
      const categoryId = (body as { categoryId: string | null }).categoryId;
      const category = categories.find((item) => item.id === categoryId);
      Object.assign(row, { categoryId, category: category ?? null, classificationSource: "MANUAL" });
      return ok(row);
    })
    .on("PATCH", /^\/transactions\/[^/]+$/, ({ path, body }) => {
      const row = rows.get(path.split("/")[2])!;
      Object.assign(row, body);
      return ok(row);
    });
  return { api, rows };
}

const openDrawer = async (user: ReturnType<typeof renderWithProviders>["user"], description: string) => {
  await user.click(await screen.findByText(description));
  return (await screen.findByText("Chi tiết giao dịch")).closest(".ant-drawer-content") as HTMLElement;
};

describe("TransactionsPage", () => {
  it("shows the empty state for a month without transactions", async () => {
    transactionsApi([]);
    renderWithProviders(<TransactionsPage />);
    expect(await screen.findByText(/Chưa có giao dịch trong tháng 09\/2026/)).toBeInTheDocument();
  });

  it("shows a list error with a retry", async () => {
    const { api } = transactionsApi([tx("t1")]);
    const first = deferred();
    let attempts = 0;
    api.on("GET", "/transactions", () => (++attempts === 1 ? first.promise : listReply([tx("t1")])));

    const { user } = renderWithProviders(<TransactionsPage />);
    await act(async () => first.resolve(fail(500, "boom")));

    expect(await screen.findByText(/Không thể tải giao dịch\. Dịch vụ tạm thời không khả dụng/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Giao dịch t1")).toBeInTheDocument();
    expect(api.calls("GET", "/transactions")).toHaveLength(2);
  });

  it("creates a manual transaction with one request for a double-clicked submit", async () => {
    const { api, rows } = transactionsApi([]);
    const created = deferred();
    api.on("POST", "/transactions", () => created.promise);

    const { user } = renderWithProviders(<TransactionsPage />);
    await screen.findByText(/Chưa có giao dịch trong tháng/);

    await user.click(screen.getByRole("button", { name: /Thêm giao dịch/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Số tiền"), "120000");
    await user.type(within(dialog).getByLabelText("Mô tả"), "Cơm trưa");
    await user.dblClick(within(dialog).getByRole("button", { name: "Thêm giao dịch" }));

    await waitFor(() => expect(api.calls("POST", "/transactions")).toHaveLength(1));
    // The second click of the double click is validated asynchronously too.
    await settle();
    expect(api.calls("POST", "/transactions")).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: /Đang thêm|Thêm giao dịch/ }));
    await settle();
    expect(api.calls("POST", "/transactions")).toHaveLength(1);
    expect(api.calls("POST", "/transactions")[0].body).toMatchObject({
      amount: 120_000,
      currency: "VND",
      direction: "EXPENSE",
      description: "Cơm trưa",
    });

    rows.set("new", tx("new", { description: "Cơm trưa", amount: 120_000 }));
    await act(async () => created.resolve(ok(rows.get("new"), 201)));
    expect(await screen.findByText("Cơm trưa")).toBeInTheDocument();
    expect(api.calls("POST", "/transactions")).toHaveLength(1);
  });

  it("updates a transaction note with one PATCH", async () => {
    const { api } = transactionsApi([tx("t1")]);
    const { user } = renderWithProviders(<TransactionsPage />);

    const drawer = await openDrawer(user, "Giao dịch t1");
    await user.type(within(drawer).getByPlaceholderText("Ghi chú cho giao dịch..."), "Ăn với đồng nghiệp");
    await user.dblClick(within(drawer).getByRole("button", { name: "Lưu ghi chú" }));

    expect(await screen.findByText("Đã lưu ghi chú")).toBeInTheDocument();
    expect(api.calls("PATCH", "/transactions/t1")).toHaveLength(1);
    expect(api.calls("PATCH", "/transactions/t1")[0].body).toEqual({ userNote: "Ăn với đồng nghiệp" });
    expect(within(drawer).getByRole("button", { name: "Lưu ghi chú" })).toBeDisabled();
  });

  it("corrects the category and shows the manual source", async () => {
    const { api } = transactionsApi([tx("t1")]);
    const { user } = renderWithProviders(<TransactionsPage />);

    const drawer = await openDrawer(user, "Giao dịch t1");
    expect(within(drawer).getByText("Rule hệ thống")).toBeInTheDocument();
    await user.click(within(drawer).getAllByRole("combobox")[0]);
    await user.click(await screen.findByTitle("Giải trí"));

    expect(await screen.findByText("Đã cập nhật nhóm giao dịch")).toBeInTheDocument();
    expect(api.calls("PATCH", "/transactions/t1/category")).toHaveLength(1);
    expect(api.calls("PATCH", "/transactions/t1/category")[0].body).toEqual({ categoryId: "fun" });
    await waitFor(() => expect(within(drawer).getByText("Bạn đã chọn")).toBeInTheDocument());
    // The drawer reloads the category history after the correction.
    await waitFor(() => expect(api.calls("GET", "/transactions/t1/category-history").length).toBeGreaterThan(1));
  });

  it("reclassifies only after confirmation, with one request", async () => {
    const { api, rows } = transactionsApi([tx("t1", { classificationSource: "MANUAL" })]);
    const pending = deferred();
    api.on("POST", "/transactions/t1/reclassify", async () => {
      const reply = await pending.promise;
      Object.assign(rows.get("t1")!, { categoryId: "food", classificationSource: "USER_RULE" });
      return reply;
    });
    const { user } = renderWithProviders(<TransactionsPage />);

    const drawer = await openDrawer(user, "Giao dịch t1");
    await user.click(within(drawer).getByRole("button", { name: "Phân loại lại" }));
    const popover = (await screen.findByText("Phân loại lại theo rule?")).closest(".ant-popover") as HTMLElement;
    expect(within(popover).getByText(/Nhóm bạn đã chọn sẽ bị thay/)).toBeInTheDocument();
    expect(api.calls("POST", "/transactions/t1/reclassify")).toHaveLength(0);

    await user.dblClick(within(popover).getByRole("button", { name: "Phân loại lại" }));
    await waitFor(() => expect(api.calls("POST", "/transactions/t1/reclassify")).toHaveLength(1));
    expect(within(drawer).getByRole("button", { name: "Đang phân loại..." })).toBeDisabled();

    await act(async () => pending.resolve(ok({ ...rows.get("t1")!, classificationSource: "USER_RULE" })));
    expect(await screen.findByText("Đã phân loại lại giao dịch theo rule hiện tại")).toBeInTheDocument();
    expect(within(drawer).getByText("Rule của bạn")).toBeInTheDocument();
    expect(api.calls("POST", "/transactions/t1/reclassify")).toHaveLength(1);
  });

  it("deletes only after confirmation, with one DELETE for a double-clicked confirm", async () => {
    const { api, rows } = transactionsApi([tx("t1"), tx("t2")]);
    const pending = deferred();
    api.on("DELETE", "/transactions/t1", async () => {
      const reply = await pending.promise;
      rows.delete("t1");
      return reply;
    });
    const { user } = renderWithProviders(<TransactionsPage />);

    const drawer = await openDrawer(user, "Giao dịch t1");
    await user.click(within(drawer).getByRole("button", { name: "Xóa giao dịch" }));
    const popover = (await screen.findByText("Xóa giao dịch này?")).closest(".ant-popover") as HTMLElement;
    expect(api.calls("DELETE", "/transactions/t1")).toHaveLength(0);

    await user.dblClick(within(popover).getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(api.calls("DELETE", "/transactions/t1")).toHaveLength(1));
    expect(within(drawer).getByRole("button", { name: "Đang xóa..." })).toBeDisabled();

    await act(async () => pending.resolve(ok(tx("t1"))));
    expect(await screen.findByText("Đã xóa giao dịch")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Giao dịch t1")).not.toBeInTheDocument());
    expect(screen.getByText("Giao dịch t2")).toBeInTheDocument();
    expect(api.calls("DELETE", "/transactions/t1")).toHaveLength(1);
  });
});
