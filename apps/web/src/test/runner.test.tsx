import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { apiRequest } from "@/api/client";
import { GoalsPage } from "@/features/goals";
import { mockApi, ok } from "./api";
import { renderWithProviders } from "./render";
import { assertAllMocksHandled, unmockedRequests } from "./setup";

describe("component test runner (T096)", () => {
  it("renders an existing page headlessly against the mocked API", async () => {
    const api = mockApi().signedIn()
      .on("GET", "/dashboard/overview", ok({ timeZone: "Asia/Ho_Chi_Minh" }))
      .on("GET", "/goals", ok([]));

    renderWithProviders(<GoalsPage />);

    expect(await screen.findByText(/Chưa có mục tiêu tài chính/)).toBeInTheDocument();
    expect(screen.getByText("Mục tiêu của bạn")).toBeInTheDocument();
    expect(api.calls("GET", "/goals")).toHaveLength(1);
  });

  it("blocks and records a request the test did not mock", async () => {
    await expect(apiRequest("/goals")).rejects.toThrow(/Unmocked network request/);
    expect(unmockedRequests).toEqual(["GET http://localhost:3000/api/goals"]);
    // Cleared here so this self-test passes; any other test with a record fails in afterEach.
    unmockedRequests.length = 0;
  });

  it("fails a test whose fake API answered a request no route handles", async () => {
    const api = mockApi().on("GET", "/goals", ok([]));

    await expect(apiRequest("/goals")).resolves.toEqual([]);
    expect(() => assertAllMocksHandled()).not.toThrow();

    await expect(apiRequest("/budgets")).rejects.toMatchObject({ status: 501 });
    expect(() => assertAllMocksHandled()).toThrow("Requests without a mocked route:\nGET /budgets");
    // Cleared here so this self-test passes; any other test with a record fails in afterEach.
    api.unhandled.length = 0;
  });
});
