import { describe, expect, it } from "vitest";
import {
  calculateDollarCost,
  resolveModelPricing,
} from "@hollowheap/core/pricing";
import {
  emptyUsage,
  setSessionBudgetCap,
  setSessionUsage,
} from "@hollowheap/core/usage";

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
});
