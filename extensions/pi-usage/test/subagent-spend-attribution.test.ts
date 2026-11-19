import { describe, expect, it } from "vitest";
import type { CumulativeUsage } from "../src/index.js";
import { combineUsage } from "../src/subagents.js";

describe("subagent usage attribution", () => {
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

  it("combining an empty row set copies usage without mutating the parent", () => {
    const byModel = {
      "model-a": {
        model: "model-a",
        inputTokens: 7,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
      },
    };
    const parent = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      totalCost: 1,
      byModel,
    };

    const combined = combineUsage(parent, []);

    expect(combined).not.toBe(parent);
    expect(combined.byModel).not.toBe(parent.byModel);
    expect(combined.totalTokens).toBe(150);
    expect(combined.totalCost).toBe(1);
    expect(parent.byModel["model-a"]?.inputTokens).toBe(7);
  });

  it("rows marked unavailable never contribute their spend", () => {
    const parent = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      totalCost: 1,
      byModel: {},
    };
    const unavailable = [
      {
        id: "generic-1",
        agent: "generic",
        status: "completed",
        model: "claude",
        available: false,
        inputTokens: 900,
        outputTokens: 900,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1800,
        cost: 42,
        byModel: {},
      },
    ];

    const combined = combineUsage(parent, unavailable);

    expect(combined.totalTokens).toBe(150);
    expect(combined.totalCost).toBe(1);
  });

  it("rolled-up subagent spend raises the combined warning flag at 80 percent", () => {
    const parent: CumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 7,
      budgetCap: 10,
      byModel: {},
    };
    const subagent = {
      id: "sub-1",
      agent: "scout",
      status: "completed",
      model: "model-a",
      available: true,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 1,
      byModel: {},
    };

    expect(parent.budgetWarning).toBeUndefined();
    const combined = combineUsage(parent, [subagent]);

    expect(combined.totalCost).toBe(8);
    expect(combined.budgetWarning).toBe(true);
  });
});
