import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DonutChart } from "./DonutChart";

describe("DonutChart", () => {
  it("shows the real total of its segments in the centre, never a fixed figure", () => {
    const { container } = render(
      <DonutChart
        segments={[
          { label: "Ăn uống", value: 1_500_000, color: "#111" },
          { label: "Di chuyển", value: 1_000_000, color: "#222" },
        ]}
      />,
    );
    const texts = [...container.querySelectorAll("text")].map((node) => node.textContent);

    expect(texts).toContain("2.5tr");
    expect(texts).not.toContain("13,8tr");
  });
});
