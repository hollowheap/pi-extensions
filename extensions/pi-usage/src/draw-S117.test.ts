import { describe, expect, it } from "vitest";
import { emptyUsage, formatUsageReport } from "./index.js";

describe("S117 compact budget usage and breakdown", () => {
  it("renders a full dollar breakdown with cap without a footer status", () => {
    const report = formatUsageReport({
      ...emptyUsage(),
      inputTokens: 100,
      totalTokens: 100,
      totalCost: 0.012,
      budgetCap: 1,
      byModel: {
        m: {
          model: "m",
          inputTokens: 100,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.012,
        },
      },
    });
    expect(report).toContain("Per-model breakdown");
    expect(report).toContain("Budget");
    expect(report).toContain("$1.00");
  });
});
