import { describe, expect, it } from "vitest";
import { combineUsage } from "./subagents.js";

describe("S152 subagent usage attribution", () => {
  it("rolls available subagent spend into parent totals and skips unavailable rows", () => {
    const parent = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      totalCost: 1,
      byModel: {},
    };
    const subagents = [
      {
        id: "sub-1",
        agent: "scout",
        status: "completed",
        model: "model-a",
        available: true,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        cost: 0.25,
        byModel: {},
      },
      {
        id: "sub-2",
        agent: "generic",
        status: "completed",
        model: "claude",
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

    const combined = combineUsage(parent, subagents);

    expect(combined.totalTokens).toBe(165);
    expect(combined.totalCost).toBeCloseTo(1.25);
  });
});
