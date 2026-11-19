import {
  USAGE_ENTRY_TYPE,
  emptyUsage,
  extractLatestUsage,
  getSessionUsage,
  recordTurnUsage,
  restoreSessionUsage,
  setSessionUsage,
} from "@hollowheap/core/usage";
import { describe, expect, it } from "vitest";

function entry(inputTokens: number, outputTokens: number, totalCost: number) {
  return {
    type: "custom",
    customType: USAGE_ENTRY_TYPE,
    data: { inputTokens, outputTokens, totalCost },
  };
}

describe("usage persistence across compaction", () => {
  it("restores the latest stored usage entry from the active branch", () => {
    const entries = [entry(10, 5, 0.1), entry(20, 10, 0.25)];
    expect(extractLatestUsage(entries).totalTokens).toBe(30);
    expect(extractLatestUsage(entries).totalCost).toBe(0.25);

    const manager = { getBranch: () => entries };
    const restored = restoreSessionUsage(manager);
    expect(restored.inputTokens).toBe(20);
    expect(restored.outputTokens).toBe(10);
    expect(restored.totalCost).toBe(0.25);
  });

  it("empty or corrupt entries yield empty usage", () => {
    expect(extractLatestUsage(undefined as never)).toMatchObject({
      totalTokens: 0,
      totalCost: 0,
    });
    const corrupt = [
      null,
      {},
      {
        customType: USAGE_ENTRY_TYPE,
        data: { inputTokens: -1, outputTokens: 1, totalCost: 0 },
      },
    ];
    expect(extractLatestUsage(corrupt).totalTokens).toBe(0);
  });

  it("a corrupt trailing entry does not discard a valid earlier one", () => {
    const bad = {
      customType: USAGE_ENTRY_TYPE,
      data: { inputTokens: "x", outputTokens: 1, totalCost: 0 },
    };
    expect(extractLatestUsage([entry(10, 5, 0.1), bad]).totalCost).toBe(0.1);
  });

  it("turn usage accumulates per model and flags 80% of the cap", () => {
    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), budgetCap: 1 });
    const after = recordTurnUsage(
      getSessionUsage(owner),
      { input: 100, output: 0 },
      0.8,
      "m",
    );
    expect(after.totalCost).toBe(0.8);
    expect(after.budgetWarning).toBe(true);
    expect(after.byModel.m).toMatchObject({
      model: "m",
      inputTokens: 100,
      cost: 0.8,
    });
  });
});
