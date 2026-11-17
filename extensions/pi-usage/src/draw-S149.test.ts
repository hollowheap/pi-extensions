import { describe, expect, it } from "vitest";
import { formatUsageReport } from "./index.js";

describe("S149 cache-aware usage report", () => {
  it("includes cache read and write tokens in the usage total", () => {
    const report = formatUsageReport({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      totalTokens: 180,
      totalCost: 0.05,
      byModel: {},
    });

    expect(report).toContain("180 tokens");
    expect(report).toContain("20 cache-read, 10 cache-write");
    expect(report).toContain("$0.05");
  });
});
