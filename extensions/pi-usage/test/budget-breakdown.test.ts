import { describe, expect, it } from "vitest";
import { emptyUsage, formatUsageReport } from "../src/index.js";

describe("compact budget usage and breakdown", () => {
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

  it("empty usage omits the per-model and budget sections", () => {
    const report = formatUsageReport(emptyUsage());
    expect(report).toContain("Token breakdown");
    expect(report).not.toContain("Per-model breakdown");
    expect(report).not.toContain("Budget");
    expect(report).toContain("0 tokens");
  });

  it("small costs use four decimals and a warning line appears when flagged", () => {
    const report = formatUsageReport({
      ...emptyUsage(),
      totalTokens: 100,
      totalCost: 0.0098,
      budgetCap: 1,
      budgetWarning: true,
    });
    expect(report).toContain("$0.0098");
    expect(report).toContain("⚠ Budget warning");
  });

  it("subagent rows distinguish unavailable from available usage", () => {
    const subagents = [
      {
        id: "s1",
        agent: "scout",
        model: "m",
        status: "failed",
        available: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
        byModel: {},
      },
      {
        id: "s2",
        agent: "review",
        model: "m",
        status: "completed",
        available: true,
        inputTokens: 10,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 10,
        cost: 0.1,
        byModel: {},
      },
    ];
    const report = formatUsageReport(
      { ...emptyUsage(), totalTokens: 10, totalCost: 0.1 },
      subagents,
    );
    expect(report).toContain("Subagents");
    expect(report).toContain("@s1 (scout) [failed]: usage unavailable");
    expect(report).toContain("@s2 (review)");
  });
});
