import {
  type SubagentUsage,
  emptyUsage,
  extractLatestUsage,
} from "@hollowheap/core/usage";
import { describe, expect, it } from "vitest";
import { formatUsageReport } from "../src/index.js";

describe("cache-aware usage report", () => {
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

  it("a zero usage report omits the model breakdown", () => {
    const report = formatUsageReport(emptyUsage());
    expect(report).toContain("0 tokens");
    expect(report).toContain("Cost: $0.00");
    expect(report).not.toContain("Per-model breakdown");
  });

  it("malformed by-model entries are skipped before formatting", () => {
    const restored = extractLatestUsage([
      {
        customType: "hollowheap.usage",
        data: {
          ...emptyUsage(),
          inputTokens: 50,
          outputTokens: 10,
          totalCost: 0.1,
          byModel: {
            good: {
              model: "good",
              inputTokens: 50,
              outputTokens: 10,
              cost: 0.1,
            },
            broken: { model: "broken", cost: -1 },
          },
        },
      },
    ]);
    const report = formatUsageReport(restored);
    expect(report).toContain("good");
    expect(report).not.toContain("broken");
  });

  it("subagent rows show availability and cost in the report", () => {
    const subagents: SubagentUsage[] = [
      {
        id: "s1",
        agent: "scout",
        model: "m1",
        status: "completed",
        available: true,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        cost: 0.12,
        byModel: {},
      },
      {
        id: "s2",
        agent: "general",
        model: "m1",
        status: "running",
        available: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
        byModel: {},
      },
    ];
    const report = formatUsageReport(emptyUsage(), subagents);
    expect(report).toContain("Subagents");
    expect(report).toContain("@s1 (scout)");
    expect(report).toContain("@s2 (general) [running]: usage unavailable");
  });
});
