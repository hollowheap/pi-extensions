import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PRICING,
  calculateDollarCost,
  formatDollarCost,
  resolveModelPricing,
} from "./pricing.js";

describe("resolveModelPricing", () => {
  it("resolves pricing from model.cost", () => {
    const model = {
      id: "custom/foo",
      cost: { input: 1.5, output: 6.0, cache_read: 0.15 },
    };
    expect(resolveModelPricing(model)).toEqual({
      input: 1.5,
      output: 6.0,
      cacheRead: 0.15,
      cacheWrite: undefined,
    });
  });

  it("resolves pricing from camelCase cacheRead and cacheWrite in model.cost", () => {
    const model = {
      id: "custom/bar",
      cost: { input: 2.0, output: 8.0, cacheRead: 0.2, cacheWrite: 1.0 },
    };
    expect(resolveModelPricing(model)).toEqual({
      input: 2.0,
      output: 8.0,
      cacheRead: 0.2,
      cacheWrite: 1.0,
    });
  });

  it("resolves pricing from static catalog by model id substring", () => {
    expect(
      resolveModelPricing({ id: "anthropic/claude-3-5-sonnet-20241022" }),
    ).toEqual(DEFAULT_MODEL_PRICING["claude-3-5-sonnet"]);
    expect(resolveModelPricing({ id: "openai/gpt-4o-mini" })).toEqual(
      DEFAULT_MODEL_PRICING["gpt-4o-mini"],
    );
  });

  it("returns undefined for unknown models without cost metadata", () => {
    expect(resolveModelPricing({ id: "unknown-model-xyz" })).toBeUndefined();
    expect(resolveModelPricing(null)).toBeUndefined();
    expect(resolveModelPricing(undefined)).toBeUndefined();
  });

  it("resolves free models to zero pricing rates", () => {
    expect(resolveModelPricing({ id: "openrouter/auto:free" })).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(resolveModelPricing("opencode-go/beam-free")).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const rates = resolveModelPricing("meta-llama/llama-3.3-70b-instruct:free");
    expect(rates).toBeDefined();
    if (!rates) return;
    const cost = calculateDollarCost(
      {
        input: 1_000_000,
        output: 500_000,
        cacheRead: 200_000,
        cacheWrite: 100_000,
      },
      rates,
    );
    expect(cost).toBe(0);
    expect(formatDollarCost(cost)).toBe("$0.00");
  });
});

describe("calculateDollarCost and formatDollarCost", () => {
  it("computes cost based on prompt and completion token rates", () => {
    const rates = { input: 3.0, output: 15.0 };
    // 100k input ($0.30) + 10k output ($0.15) = $0.45
    const cost = calculateDollarCost({ input: 100_000, output: 10_000 }, rates);
    expect(cost).toBeCloseTo(0.45);
  });

  it("includes cache read/write rates when present", () => {
    const rates = {
      input: 3.0,
      output: 15.0,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    };
    const cost = calculateDollarCost(
      { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
      rates,
    );
    expect(cost).toBeCloseTo(4.05);
  });

  it("formats dollar values accurately", () => {
    expect(formatDollarCost(0)).toBe("$0.00");
    expect(formatDollarCost(0.0042)).toBe("$0.0042");
    expect(formatDollarCost(1.25)).toBe("$1.25");
  });

  it("handles non-finite and negative usage gracefully", () => {
    const rates = { input: 3.0, output: 15.0 };
    expect(
      calculateDollarCost({ input: Number.NaN, output: 10_000 }, rates),
    ).toBe(0);
    expect(
      calculateDollarCost(
        { input: 10_000, output: Number.POSITIVE_INFINITY },
        rates,
      ),
    ).toBe(0);
    expect(calculateDollarCost({ input: -5, output: 10_000 }, rates)).toBe(0);
  });
});
