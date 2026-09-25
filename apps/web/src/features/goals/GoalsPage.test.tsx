import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, mockApi, ok, type MockApi } from "@/test/api";
import { renderWithProviders, settle } from "@/test/render";
import type { GoalFeasibility } from "@/types/goal";
import { GoalsPage } from "./components/GoalsPage";

const goal = (id: string, name: string) => ({
  id,
  name,
  type: "SAVING",
  targetAmount: 12_000_000,
  savedAmount: 2_000_000,
  remainingAmount: 10_000_000,
  targetDate: null,
  months: 6,
  currency: "VND",
});

const feasibility = (goalId: string, overrides: Partial<GoalFeasibility> = {}): GoalFeasibility => ({
  goalId,
  scenario: "FULL",
  months: 6,
  horizonSource: "GOAL_MONTHS",
  pastDeadline: false,
  targetAmount: 12_000_000,
  savedAmount: 2_000_000,
  remainingAmount: 10_000_000,
  totalCost: 10_000_000,
  monthlyRequired: 1_666_667,
  feasibilityScore: 80,
  status: "SAFE",
  availableMonthlyCashflow: 5_000_000,
  observationMonths: ["2026-06", "2026-07", "2026-08"],
  monthsRequired: 0,
  reason: "COMPLETED_MONTHS_AVERAGE",
  ...overrides,
});

const baseApi = (): MockApi => mockApi().signedIn().on("GET", "/dashboard/overview", ok({ timeZone: "Asia/Ho_Chi_Minh" }));

describe("GoalsPage", () => {
  it("shows a loading state until the goals arrive, then the empty state", async () => {
    const list = deferred();
    baseApi().on("GET", "/goals", () => list.promise);

    const { container } = renderWithProviders(<GoalsPage />);

    await waitFor(() => expect(container.querySelector(".ant-skeleton")).not.toBeNull());
    expect(screen.queryByText(/Chưa có mục tiêu tài chính/)).not.toBeInTheDocument();

    await act(async () => list.resolve(ok([])));
    expect(await screen.findByText(/Chưa có mục tiêu tài chính/)).toBeInTheDocument();
  });

  it("shows an error with a retry that reloads the list once", async () => {
    let attempts = 0;
    const api = baseApi().on("GET", "/goals", () => (++attempts === 1 ? fail(503, "Service unavailable") : ok([goal("g1", "Mua xe")])))
      .on("GET", "/goals/g1/simulation", ok(feasibility("g1")));

    const { user } = renderWithProviders(<GoalsPage />);

    expect(await screen.findByText(/Không thể tải mục tiêu\. Dịch vụ tạm thời không khả dụng/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(await screen.findByText("Khả năng hoàn thành · Mua xe")).toBeInTheDocument();
    expect(api.calls("GET", "/goals")).toHaveLength(2);
  });

  it("shows the insufficient-data state without a score or estimated figures", async () => {
    baseApi()
      .on("GET", "/goals", ok([goal("g1", "Quỹ dự phòng")]))
      .on(
        "GET",
        "/goals/g1/simulation",
        ok(
          feasibility("g1", {
            status: "INSUFFICIENT_DATA",
            feasibilityScore: null,
            availableMonthlyCashflow: null,
            observationMonths: ["2026-08"],
            monthsRequired: 1,
            reason: "INSUFFICIENT_HISTORY",
          }),
        ),
      );

    renderWithProviders(<GoalsPage />);

    expect(await screen.findByText("Chưa đủ dữ liệu để đánh giá")).toBeInTheDocument();
    expect(screen.getByText("Chưa có điểm khả thi")).toBeInTheDocument();
    expect(screen.getByText(/Cần thêm 1 tháng hoàn chỉnh/)).toBeInTheDocument();
    expect(screen.getByText(/Đã có: 08\/2026\./)).toBeInTheDocument();
    expect(screen.queryByText(/Điểm khả thi \d+\/100/)).not.toBeInTheDocument();
    expect(screen.queryByText("Dòng tiền khả dụng trung bình")).not.toBeInTheDocument();
  });

  it("never lets a late response for the previous goal overwrite the newly selected goal", async () => {
    const first = deferred();
    const second = deferred();
    baseApi()
      .on("GET", "/goals", ok([goal("a", "Mục tiêu A"), goal("b", "Mục tiêu B")]))
      .on("GET", "/goals/a/simulation", () => first.promise)
      .on("GET", "/goals/b/simulation", () => second.promise);

    const { user } = renderWithProviders(<GoalsPage />);

    expect(await screen.findByText("Khả năng hoàn thành · Mục tiêu A")).toBeInTheDocument();
    await user.click(screen.getByText("Mục tiêu B"));
    expect(await screen.findByText("Khả năng hoàn thành · Mục tiêu B")).toBeInTheDocument();

    await act(async () => second.resolve(ok(feasibility("b", { feasibilityScore: 82 }))));
    expect(await screen.findByText(/Điểm khả thi 82\/100/)).toBeInTheDocument();

    // A's answer arrives after B was selected and already shown.
    await act(async () => first.resolve(ok(feasibility("a", { feasibilityScore: 11, status: "NOT_RECOMMENDED" }))));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.getByText("Khả năng hoàn thành · Mục tiêu B")).toBeInTheDocument();
    expect(screen.getByText(/Điểm khả thi 82\/100/)).toBeInTheDocument();
    expect(screen.queryByText(/Điểm khả thi 11\/100/)).not.toBeInTheDocument();
  });

  it("does not show the previous goal's result while the newly selected goal is loading", async () => {
    const second = deferred();
    baseApi()
      .on("GET", "/goals", ok([goal("a", "Mục tiêu A"), goal("b", "Mục tiêu B")]))
      .on("GET", "/goals/a/simulation", ok(feasibility("a", { feasibilityScore: 11, status: "NOT_RECOMMENDED" })))
      .on("GET", "/goals/b/simulation", () => second.promise);

    const { container, user } = renderWithProviders(<GoalsPage />);

    expect(await screen.findByText(/Điểm khả thi 11\/100/)).toBeInTheDocument();
    await user.click(screen.getByText("Mục tiêu B"));

    expect(await screen.findByText("Khả năng hoàn thành · Mục tiêu B")).toBeInTheDocument();
    // refine keeps A's data as a placeholder for B's query; the page must not present it as B's.
    expect(screen.queryByText(/Điểm khả thi 11\/100/)).not.toBeInTheDocument();
    expect(container.querySelector(".ant-skeleton")).not.toBeNull();

    await act(async () => second.resolve(ok(feasibility("b", { feasibilityScore: 82 }))));
    expect(await screen.findByText(/Điểm khả thi 82\/100/)).toBeInTheDocument();
    expect(screen.queryByText(/Điểm khả thi 11\/100/)).not.toBeInTheDocument();
  });

  it("sends one create request for a double-clicked submit", async () => {
    const created = deferred();
    const api = baseApi()
      .on("GET", "/goals", ok([]))
      .on("POST", "/goals", () => created.promise)
      .on("GET", "/goals/g9/simulation", ok(feasibility("g9")));

    const { user } = renderWithProviders(<GoalsPage />);
    await screen.findByText(/Chưa có mục tiêu tài chính/);

    await user.click(screen.getByRole("button", { name: /Tạo mục tiêu/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Tên mục tiêu"), "Laptop");
    await user.type(within(dialog).getByLabelText("Số tiền mục tiêu"), "20000000");
    await user.dblClick(within(dialog).getByRole("button", { name: "Tạo mục tiêu" }));

    await waitFor(() => expect(api.calls("POST", "/goals")).toHaveLength(1));
    // The second click of the double click is validated asynchronously too.
    await settle();
    expect(api.calls("POST", "/goals")).toHaveLength(1);
    // Still in flight: more clicks must not send another request.
    await user.click(within(dialog).getByRole("button", { name: /Đang tạo|Tạo mục tiêu/ }));
    await settle();
    expect(api.calls("POST", "/goals")).toHaveLength(1);
    expect(api.calls("POST", "/goals")[0].body).toMatchObject({ name: "Laptop", targetAmount: 20_000_000 });

    api.on("GET", "/goals", ok([goal("g9", "Laptop")]));
    await act(async () => created.resolve(ok({ id: "g9" }, 201)));
    expect(await screen.findByText("Khả năng hoàn thành · Laptop")).toBeInTheDocument();
    expect(api.calls("POST", "/goals")).toHaveLength(1);
  });
});
