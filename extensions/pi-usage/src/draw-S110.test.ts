import {
  calculateDollarCost,
  messageCost,
  resolveModelPricing,
} from "@hollowheap/core/pricing";
import {
  emptyUsage,
  setSessionBudgetCap,
  setSessionUsage,
} from "@hollowheap/core/usage";
import { describe, expect, it } from "vitest";

describe("S110 dollar budget caps", () => {
  it("computes dollar cost from pricing and flags usage at the configured cap", () => {
    const rates = resolveModelPricing("test/model");
    const cost = calculateDollarCost(
      { input: 1_000_000, output: 0 },
      { input: 2, output: 4, ...rates },
    );
    expect(cost).toBe(2);

    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), totalCost: 2 });
    const capped = setSessionBudgetCap(owner, 2);
    expect(capped.budgetCap).toBe(2);
    expect(capped.budgetWarning).toBe(true);
  });

  it("S110 C02: unknown models have no pricing and invalid usage prices at zero", () => {
    expect(resolveModelPricing("totally-unknown-model")).toBeUndefined();
    const rates = { input: 2, output: 4 };
    expect(calculateDollarCost({ input: -1, output: 10 }, rates)).toBe(0);
    expect(calculateDollarCost({ input: Number.NaN, output: 10 }, rates)).toBe(
      0,
    );
  });

  it("S110 C03: provider cost metadata with bad fields falls back to static pricing", () => {
    const rates = resolveModelPricing({
      id: "claude-3-5-haiku",
      cost: { input: "bad", output: 4 },
    });
    expect(rates).toMatchObject({ input: 0.8, output: 4 });
    expect(messageCost(null)).toBe(0);
  });

  it("S110 C04: cache tokens contribute to cost and no warning fires below 80%", () => {
    const rates = resolveModelPricing("claude-3-5-sonnet");
    expect(rates?.cacheRead).toBe(0.3);
    const cost = calculateDollarCost(
      { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
      rates as NonNullable<typeof rates>,
    );
    expect(cost).toBeCloseTo(4.05);

    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), totalCost: 1 });
    const capped = setSessionBudgetCap(owner, 2);
    expect(capped.budgetCap).toBe(2);
    expect(capped.budgetWarning).toBeUndefined();
  });
});
