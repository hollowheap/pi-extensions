import { describe, expect, it } from "vitest";
import {
  addBudgetUsage,
  clearBudget,
  formatBudget,
  getBudgetUsed,
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
});

describe("formatBudget", () => {
  it("shows used and remaining with a cap", () => {
    expect(formatBudget(12500, 100000)).toBe("12,500 used, 87,500 remaining");
  });

  it("floors remaining at zero past the cap", () => {
    expect(formatBudget(120000, 100000)).toBe("120,000 used, 0 remaining");
  });

  it("shows used alone without a cap", () => {
    expect(formatBudget(500, undefined)).toBe("500 used");
    expect(formatBudget(0, undefined)).toBe("");
  });
});
