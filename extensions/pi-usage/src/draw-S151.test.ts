import { describe, expect, it } from "vitest";
import {
  emptyUsage,
  formatUsageReport,
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

  it("S151 C02: clearing a warned cap drops both cap and warning state", () => {
    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), totalCost: 9 });
    setSessionBudgetCap(owner, 10);
    expect(getSessionUsage(owner).budgetWarning).toBe(true);

    const cleared = setSessionBudgetCap(owner, undefined);

    expect(cleared.budgetCap).toBeUndefined();
    expect(cleared.budgetWarning).toBeUndefined();
    expect(getSessionUsage(owner).budgetCap).toBeUndefined();
  });

  it("S151 C03: a fresh cap below the warning threshold leaves warning unset", () => {
    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), totalCost: 1 });

    const capped = setSessionBudgetCap(owner, 10);

    expect(capped.budgetCap).toBe(10);
    expect(capped.budgetWarning).toBeUndefined();
  });

  it("S151 C04: the usage report renders the stored cap and warning to consumers", () => {
    const owner = {};
    setSessionUsage(owner, { ...emptyUsage(), totalCost: 8 });
    setSessionBudgetCap(owner, 10);

    const report = formatUsageReport(getSessionUsage(owner));

    expect(report).toContain("$8.00 / $10.00");
    expect(report).toContain("Budget warning: 8.00 / 10.00");
  });
});
