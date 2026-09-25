import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockApi, ok } from "@/test/api";
import { renderWithProviders } from "@/test/render";
import type { ApiBankProvider } from "@/types/account";
import { OpsPage } from "./components/OpsPage";

const provider = (id: string, name: string, status?: string): ApiBankProvider => ({ id, code: id.toUpperCase(), name, status, emailSenders: [] });

/** A SparkLine chart (its gradient), as opposed to an icon. */
const sparklines = (container: HTMLElement) => container.querySelectorAll('linearGradient[id^="sp-"]');

describe("OpsPage", () => {
  it("shows each provider's status from the API and draws no invented trend lines", async () => {
    mockApi()
      .signedIn()
      .on("GET", "/bank-providers", ok([provider("vcb", "Vietcombank", "ACTIVE"), provider("tcb", "Techcombank", "INACTIVE"), provider("mb", "MB Bank", "EXPERIMENTAL")]))
      .on("GET", "/parser-templates", ok([]))
      .on("GET", "/email-messages", ok({ data: [], total: 0, page: 1, limit: 20 }))
      .on("GET", "/alerts", ok({ data: [], total: 0, page: 1, limit: 20 }))
      .on("GET", "/email-connections", ok([]));

    const { container } = renderWithProviders(<OpsPage />);

    const row = (name: string) => (screen.getByText(name).closest(".grid") as HTMLElement);
    await screen.findByText("Techcombank");
    expect(within(row("Vietcombank")).getByText("Hoạt động")).toBeInTheDocument();
    expect(within(row("Techcombank")).getByText("Ngừng hoạt động")).toBeInTheDocument();
    expect(within(row("Techcombank")).queryByText("Hoạt động")).not.toBeInTheDocument();
    expect(within(row("MB Bank")).getByText("Thử nghiệm")).toBeInTheDocument();
    // The KPI cards have one count each, not a series: no sparkline pretends there is a trend.
    expect(screen.getByText("Ngân hàng hỗ trợ")).toBeInTheDocument();
    expect(sparklines(container)).toHaveLength(0);
  });
});
