import { describe, expect, it, vi } from "vitest";
import { USAGE_ENTRY_TYPE, restoreSessionUsage } from "./usage.js";

describe("restoreSessionUsage", () => {
  it("reads the active branch before all session entries across two branches", () => {
    const branchA = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 1_000,
          outputTokens: 500,
          totalCost: 0.5,
          byModel: {
            "model-a": {
              model: "model-a",
              inputTokens: 1_000,
              outputTokens: 500,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              cost: 0.5,
            },
          },
        },
      },
    ];
    const branchB = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 200,
          outputTokens: 100,
          totalCost: 0.1,
          byModel: {
            "model-b": {
              model: "model-b",
              inputTokens: 200,
              outputTokens: 100,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              cost: 0.1,
            },
          },
        },
      },
    ];

    const getBranch = vi.fn(() => branchA);
    const getEntries = vi.fn(() => [...branchA, ...branchB]);
    const manager = { getBranch, getEntries };

    const restored = restoreSessionUsage(manager);
    expect(getBranch).toHaveBeenCalledTimes(1);
    expect(getEntries).not.toHaveBeenCalled();
    expect(restored.totalCost).toBe(0.5);
    expect(Object.keys(restored.byModel)).toEqual(["model-a"]);
  });

  it("falls back to getEntries only when getBranch is absent", () => {
    const entries = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 300,
          outputTokens: 150,
          totalCost: 0.25,
        },
      },
    ];
    const getEntries = vi.fn(() => entries);
    const restored = restoreSessionUsage({ getEntries });
    expect(getEntries).toHaveBeenCalledTimes(1);
    expect(restored.totalCost).toBe(0.25);
  });
});
