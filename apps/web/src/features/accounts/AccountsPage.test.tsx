import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockApi, ok } from "@/test/api";
import { renderWithProviders } from "@/test/render";
import { AccountsPage } from "./components/AccountsPage";

describe("AccountsPage", () => {
  it("shows the balance from the API without an invented balance history", async () => {
    mockApi()
      .signedIn()
      .on("GET", "/financial-accounts", ok([{ id: "a1", name: "VCB thanh toán", institutionName: "Vietcombank", type: "CHECKING", currentBalance: 5_000_000 }]))
      .on("GET", "/bank-providers", ok([]));

    const { container } = renderWithProviders(<AccountsPage />);

    expect(await screen.findByText("Vietcombank")).toBeInTheDocument();
    // The API sends only the current balance, so there is no series to draw a sparkline from.
    expect(container.querySelectorAll('linearGradient[id^="sp-"]')).toHaveLength(0);
  });
});
