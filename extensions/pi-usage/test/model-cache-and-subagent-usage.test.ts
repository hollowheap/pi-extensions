import {
  USAGE_ENTRY_TYPE,
  emptyUsage,
  extractLatestUsage,
  persistUsage,
  recordTurnUsage,
} from "@hollowheap/core/usage";
import { describe, expect, it } from "vitest";

describe("per-model, cache, and subagent usage", () => {
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

  it("an all-zero turn and an empty branch stay empty", () => {
    const empty = emptyUsage();
    const noop = recordTurnUsage(empty, { input: 0, output: 0 }, 0);
    expect(noop).toBe(empty);
    expect(extractLatestUsage([])).toEqual(empty);
  });

  it("negative and non-finite turn values are ignored", () => {
    const usage = emptyUsage();
    const result = recordTurnUsage(
      usage,
      { input: -10, output: Number.NaN, cacheRead: -3 },
      -1,
      "broken",
    );
    expect(result).toBe(usage);
    expect(result.totalTokens).toBe(0);
    expect(result.byModel.broken).toBeUndefined();
  });

  it("persisted usage is restored with recomputed tokens and clean models", () => {
    const appended: Array<{ customType: string; data: unknown }> = [];
    const usage = recordTurnUsage(
      emptyUsage(),
      { input: 12, output: 8, cacheRead: 3, cacheWrite: 2 },
      0.25,
      "m2",
    );
    const manager = {
      appendCustomEntry: (customType: string, data: unknown) => {
        appended.push({ customType, data });
      },
    };
    persistUsage(manager, usage);

    const restored = extractLatestUsage(appended);
    expect(restored.totalTokens).toBe(25);
    expect(restored.byModel.m2).toMatchObject({ cost: 0.25 });
    expect(restored.totalCost).toBe(0.25);
  });
});
