import { describe, expect, it } from "vitest";
import {
  USAGE_ENTRY_TYPE,
  emptyUsage,
  extractLatestUsage,
  recordTurnUsage,
} from "@hollowheap/core/usage";

describe("S126 per-model, cache, and subagent usage", () => {
  it("tracks cache tokens per model, warns at 80% of cap, and reads subagent usage", () => {
    const usage = recordTurnUsage(
      emptyUsage(),
      { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
      0.5,
      "m1",
    );
    expect(usage.byModel.m1).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      cost: 0.5,
    });
    const warned = recordTurnUsage(
      { ...usage, budgetCap: 1 },
      { input: 0, output: 0 },
      0.35,
      "m1",
    );
    expect(warned.budgetWarning).toBe(true);

    const restored = extractLatestUsage([
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          ...emptyUsage(),
          totalCost: 0.6,
          subagents: [
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
              cost: 0.1,
              byModel: {},
            },
          ],
        },
      },
    ]);
    expect(restored.subagents?.[0].id).toBe("s1");
    expect(restored.subagents?.[0].cost).toBe(0.1);
  });
});
