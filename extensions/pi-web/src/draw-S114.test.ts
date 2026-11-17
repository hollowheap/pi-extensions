import { describe, expect, it } from "vitest";
import {
  calculateDollarCost,
  resolveModelPricing,
} from "@hollowheap/core/pricing";
import { createWebFetchTool, createWebSearchTool } from "./tools.js";

describe("S114 codemode web tools and free pricing", () => {
  it("registers web tools only as codemode and prices :free models at zero", () => {
    expect(createWebSearchTool().exposure).toBe("codemode");
    expect(createWebFetchTool().exposure).toBe("codemode");

    const rates = resolveModelPricing("provider/foo:free");
    expect(rates).toMatchObject({ input: 0, output: 0 });
    expect(
      calculateDollarCost({ input: 1_000_000, output: 1_000_000 }, rates!),
    ).toBe(0);
  });
});
