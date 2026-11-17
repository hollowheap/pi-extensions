import { describe, expect, it } from "vitest";
import {
  emptyUsage,
  getSessionUsage,
  setSessionBudgetCap,
  setSessionUsage,
} from "./index.js";

describe("S151 USD-only cap warning", () => {
  it("marks an 80-percent dollar cap as warning without a mandatory cap", () => {
    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), totalCost: 8 });

    const capped = setSessionBudgetCap(owner, 10);

    expect(capped.budgetCap).toBe(10);
    expect(capped.budgetWarning).toBe(true);
    expect(getSessionUsage(owner).budgetWarning).toBe(true);
  });
});
