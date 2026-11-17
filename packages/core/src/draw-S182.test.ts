import { describe, expect, it } from "vitest";
import { messageCost } from "./pricing.js";

describe("S182 unified message cost", () => {
  it("uses the provider cost total when it is finite and positive", () => {
    const cost = messageCost(
      { input: 100_000, output: 10_000, cost: { total: 0.123 } },
      "unpriced-model",
    );

    expect(cost).toBe(0.123);
  });
});
