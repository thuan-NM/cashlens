import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, mockApi, ok } from "@/test/api";
import { renderWithProviders, settle } from "@/test/render";
import { BudgetsPage } from "./components/BudgetsPage";

const budget = {
  id: "b1",
  name: "Ăn uống",
  categoryId: null,
  amount: 3_000_000,
  currency: "VND",
  period: "MONTHLY",
  thresholdPercent: 80,
  usage: { spent: 2_500_000, percentUsed: 83, isNearThreshold: true, isOverLimit: false },
};

const budgetsApi = () =>
  mockApi().signedIn()
    .on("GET", "/budgets/summary", ok({ totalLimit: 3_000_000, totalSpent: 2_500_000 }))
    .on("GET", "/transaction-categories", ok([]));

describe("BudgetsPage", () => {
  it("shows loading, then the empty state", async () => {
    const list = deferred();
    budgetsApi().on("GET", "/budgets", () => list.promise);

    const { container } = renderWithProviders(<BudgetsPage />);
    await waitFor(() => expect(container.querySelector(".ant-skeleton")).not.toBeNull());

    await act(async () => list.resolve(ok([])));
    expect(await screen.findByText(/Chưa có ngân sách\./)).toBeInTheDocument();
  });

  it("shows an error, and a retry loads the budgets", async () => {
    let attempts = 0;
    const api = budgetsApi().on("GET", "/budgets", () => (++attempts === 1 ? fail(403, "Forbidden") : ok([budget])));

    const { user } = renderWithProviders(<BudgetsPage />);

    expect(await screen.findByText(/Không thể tải ngân sách\. Bạn không có quyền thực hiện thao tác này\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByTestId("budget-b1")).toHaveTextContent("83%");
    expect(screen.getByTestId("budget-threshold")).toHaveTextContent("Cảnh báo ở 80% · nghiêm trọng ở 100%");
    expect(api.calls("GET", "/budgets")).toHaveLength(2);
  });

  it("sends one create request for a double-clicked submit and shows field errors from the API", async () => {
    const created = deferred();
    const api = budgetsApi()
      .on("GET", "/budgets", ok([]))
      .on("POST", "/budgets", () => created.promise);

    const { user } = renderWithProviders(<BudgetsPage />);
    await screen.findByText(/Chưa có ngân sách\./);

    await user.click(screen.getByRole("button", { name: /Tạo ngân sách/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tên ngân sách"), "Cà phê");
    await user.type(within(dialog).getByLabelText("Hạn mức"), "500000");
    await user.dblClick(within(dialog).getByRole("button", { name: "Tạo ngân sách" }));

    await waitFor(() => expect(api.calls("POST", "/budgets")).toHaveLength(1));
    // The second click of the double click is validated asynchronously too.
    await settle();
    expect(api.calls("POST", "/budgets")).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: /Đang tạo|Tạo ngân sách/ }));
    await settle();
    expect(api.calls("POST", "/budgets")).toHaveLength(1);
    expect(api.calls("POST", "/budgets")[0].body).toMatchObject({ name: "Cà phê", amount: 500_000, period: "MONTHLY", thresholdPercent: 80 });

    await act(async () => created.resolve(fail(400, ["amount must be a positive number"])));
    expect(await within(dialog).findByText("amount must be a positive number")).toBeInTheDocument();
    expect(api.calls("POST", "/budgets")).toHaveLength(1);
  });
});
