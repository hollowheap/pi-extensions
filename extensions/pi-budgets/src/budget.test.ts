import {
  calculateDollarCost,
  formatDollarCost,
  resolveModelPricing,
} from "@hollowheap/core";
import { describe, expect, it } from "vitest";
import {
  addBudgetUsage,
  addDollarUsage,
  clearBudget,
  clearDollarCap,
  formatBudget,
  formatCompactBudget,
  formatCompactDollarBudget,
  getBudgetUsed,
  getDollarCap,
  getDollarUsed,
  setDollarCap,
} from "./budget.js";

describe("budget totals", () => {
  it("accumulates per session owner", () => {
    const owner = {};
    expect(getBudgetUsed(owner)).toBe(0);
    expect(addBudgetUsage(owner, 100)).toBe(100);
    expect(addBudgetUsage(owner, 50)).toBe(150);
    expect(getBudgetUsed({})).toBe(0);
    clearBudget(owner);
    expect(getBudgetUsed(owner)).toBe(0);
  });

  it("accumulates dollar usage per session owner", () => {
    const owner = {};
    expect(getDollarUsed(owner)).toBe(0);
    expect(addDollarUsage(owner, 0.05)).toBeCloseTo(0.05);
    expect(addDollarUsage(owner, 0.12)).toBeCloseTo(0.17);
    expect(getDollarUsed({})).toBe(0);
    clearBudget(owner);
    expect(getDollarUsed(owner)).toBe(0);
  });

  it("sets and clears dollar cap", () => {
    const owner = {};
    expect(getDollarCap(owner)).toBeUndefined();
    setDollarCap(owner, 5.0);
    expect(getDollarCap(owner)).toBe(5.0);
    clearDollarCap(owner);
    expect(getDollarCap(owner)).toBeUndefined();
  });
});

describe("formatBudget", () => {
  it("shows used and remaining with a token cap", () => {
    expect(formatBudget(12500, 100000)).toBe("12,500 used, 87,500 remaining");
  });

  it("floors remaining at zero past the cap", () => {
    expect(formatBudget(120000, 100000)).toBe("120,000 used, 0 remaining");
  });

  it("shows used alone without a cap", () => {
    expect(formatBudget(500, undefined)).toBe("500 used");
    expect(formatBudget(0, undefined)).toBe("");
  });

  it("formats dollar cap and remaining dollars", () => {
    expect(formatBudget(1000, undefined, 0.5, 2.0)).toBe(
      "$0.50 used, $1.50 remaining",
    );
    expect(formatBudget(1000, 5000, 2.5, 2.0)).toBe(
      "$2.50 used, $0.00 remaining (1,000 / 5,000 tokens)",
    );
  });
});

describe("formatCompactBudget", () => {
  it("formats compact dollar ratio with matching precision", () => {
    expect(formatCompactDollarBudget(0.012, 1.0)).toBe("$0.012/$1.000");
    expect(formatCompactDollarBudget(0.5, 2.0)).toBe("$0.50/$2.00");
    expect(formatCompactBudget(1000, undefined, 0.012, 1.0)).toBe(
      "$0.012/$1.000",
    );
    expect(formatCompactBudget(1000, undefined, 0.5, 2.0)).toBe("$0.50/$2.00");
  });

  it("formats dollar usage when no cap is set", () => {
    expect(formatCompactBudget(1000, undefined, 0.012, undefined)).toBe(
      "$0.012",
    );
    expect(formatCompactBudget(1000, undefined, 0.5, undefined)).toBe("$0.50");
  });

  it("formats compact token ratio when token cap is set without dollar cap", () => {
    expect(formatCompactBudget(12500, 100000)).toBe("12,500/100,000");
  });

  it("formats token usage alone without cap", () => {
    expect(formatCompactBudget(500, undefined)).toBe("500");
    expect(formatCompactBudget(0, undefined)).toBe("");
  });
});

describe("pricing resolution and cost calculation", () => {
  it("resolves pricing from model.cost", () => {
    const model = {
      id: "custom-model",
      cost: { input: 2.0, output: 8.0, cache_read: 0.5 },
    };
    const pricing = resolveModelPricing(model);
    expect(pricing).toEqual({
      input: 2.0,
      output: 8.0,
      cacheRead: 0.5,
      cacheWrite: undefined,
    });
  });

  it("falls back to default catalog by model ID", () => {
    const model = { id: "claude-3-5-sonnet-20241022" };
    const pricing = resolveModelPricing(model);
    expect(pricing).toBeDefined();
    expect(pricing?.input).toBe(3.0);
    expect(pricing?.output).toBe(15.0);
  });

  it("calculates cost accurately with token usage", () => {
    const rates = { input: 3.0, output: 15.0, cacheRead: 0.3 };
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 500_000 };
    const cost = calculateDollarCost(usage, rates);
    // 3.0 + 1.5 + 0.15 = 4.65
    expect(cost).toBeCloseTo(4.65);
    expect(formatDollarCost(cost)).toBe("$4.65");
  });
});
