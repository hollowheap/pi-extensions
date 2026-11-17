import { describe, expect, it } from "vitest";
import { formatUsageReport } from "./index.js";

describe("S150 dollar cap display", () => {
  it("shows used and cap as dollar amounts under the budget line", () => {
    const report = formatUsageReport({
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      totalCost: 2.5,
      budgetCap: 5,
      byModel: {},
    });

    expect(report).toMatch(/Budget [█░]{16} \$2\.50 \/ \$5\.00/);
  });
});
