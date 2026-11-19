import { describe, expect, it } from "vitest";
import { formatDollarCost, messageCost } from "../src/pricing.js";

describe("unified message cost", () => {
  it("uses the provider cost total when it is finite and positive", () => {
    const cost = messageCost(
      { input: 100_000, output: 10_000, cost: { total: 0.123 } },
      "unpriced-model",
    );

    expect(cost).toBe(0.123);
  });

  it("a zero or non-finite provider total falls back to the price table", () => {
    const usage = { input: 100_000, output: 10_000 };
    expect(
      messageCost({ ...usage, cost: { total: 0 } }, "claude-3-5-sonnet"),
    ).toBeCloseTo(0.45);
    expect(
      messageCost(
        { ...usage, cost: { total: Number.NaN } },
        "claude-3-5-sonnet",
      ),
    ).toBeCloseTo(0.45);
  });

  it("absent usage or an unpriced model reports zero", () => {
    expect(messageCost(null, "unpriced-model")).toBe(0);
    expect(messageCost(undefined, "unpriced-model")).toBe(0);
    expect(messageCost({}, "totally-unpriced-model")).toBe(0);
  });

  it("a nested message uses its own model and formats one total", () => {
    const cost = messageCost({
      usage: { input: 100_000, output: 0 },
      model: "claude-3-5-haiku",
    });
    expect(cost).toBeCloseTo(0.08);
    expect(formatDollarCost(cost)).toBe("$0.08");
  });
});
