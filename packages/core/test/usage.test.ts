import { describe, expect, it, vi } from "vitest";
import {
  USAGE_ENTRY_TYPE,
  clearSessionUsage,
  emptyUsage,
  getSessionUsage,
  persistUsage,
  recordAuxiliaryUsage,
  restoreSessionUsage,
  setSessionUsage,
} from "../src/usage.js";

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

  it("persists usage via appendCustomEntry or appendEntry and ignores errors", () => {
    const usage = { ...emptyUsage(), inputTokens: 5, totalTokens: 5 };
    const appendCustomEntry = vi.fn();
    const appendEntry = vi.fn();
    persistUsage({ appendCustomEntry, appendEntry }, usage);
    expect(appendCustomEntry).toHaveBeenCalledWith(USAGE_ENTRY_TYPE, usage);
    expect(appendEntry).not.toHaveBeenCalled();

    persistUsage({ appendEntry }, usage);
    expect(appendEntry).toHaveBeenCalledWith(USAGE_ENTRY_TYPE, usage);

    expect(() =>
      persistUsage(
        {
          appendCustomEntry: () => {
            throw new Error("write failed");
          },
        },
        usage,
      ),
    ).not.toThrow();
  });
});

describe("activeUsage", () => {
  it("shares active usage WeakMap via Symbol.for('@hollowheap/core/usage') on globalThis", () => {
    const key = Symbol.for("@hollowheap/core/usage");
    const target = globalThis as unknown as Record<symbol, unknown>;
    const owner = {};
    const usage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0.05,
      byModel: {},
    };
    setSessionUsage(owner, usage);
    const map = target[key] as WeakMap<object, unknown>;
    expect(map).toBeInstanceOf(WeakMap);
    expect(map.get(owner)).toEqual(usage);
    expect(getSessionUsage(owner)).toEqual(usage);
    clearSessionUsage(owner);
    expect(map.has(owner)).toBe(false);
  });
});

describe("recordAuxiliaryUsage", () => {
  it("computes cost, updates cumulative usage, persists to sessionManager, calls appendEntry, and emits usage:refresh", () => {
    const appendCustomEntry = vi.fn();
    const sessionManager = {
      getBranch: () => [],
      appendCustomEntry,
    };
    const appendEntry = vi.fn();
    const emitEvent = vi.fn();

    const { cost, cumulative } = recordAuxiliaryUsage({
      sessionManager,
      modelId: "provider/aux-model",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 5,
        cacheWrite: 0,
        cost: { total: 0.025 },
      },
      appendEntry,
      emitEvent,
    });

    expect(cost).toBe(0.025);
    expect(cumulative.totalTokens).toBe(125);
    expect(cumulative.totalCost).toBe(0.025);
    expect(cumulative.byModel["provider/aux-model"]).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      cost: 0.025,
    });
    expect(getSessionUsage(sessionManager)).toEqual(cumulative);
    expect(appendCustomEntry).toHaveBeenCalledWith(
      USAGE_ENTRY_TYPE,
      cumulative,
    );
    expect(appendEntry).toHaveBeenCalledWith(USAGE_ENTRY_TYPE, cumulative);
    expect(emitEvent).toHaveBeenCalledWith("usage:refresh", undefined);
  });
});
