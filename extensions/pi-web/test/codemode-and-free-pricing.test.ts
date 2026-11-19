import {
  calculateDollarCost,
  resolveModelPricing,
} from "@hollowheap/core/pricing";
import { describe, expect, it } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "../src/tools.js";

describe("codemode web tools and free pricing", () => {
  it("registers web tools only as codemode and prices :free models at zero", () => {
    expect(createWebSearchTool().exposure).toBe("codemode");
    expect(createWebFetchTool().exposure).toBe("codemode");

    const rates = resolveModelPricing("provider/foo:free");
    expect(rates).toMatchObject({ input: 0, output: 0 });
    expect(
      calculateDollarCost(
        { input: 1_000_000, output: 1_000_000 },
        rates as NonNullable<typeof rates>,
      ),
    ).toBe(0);
  });

  it("known models resolve rates while unknown models do not", () => {
    expect(resolveModelPricing("claude-3-5-sonnet")).toMatchObject({
      input: 3,
      output: 15,
    });
    expect(resolveModelPricing("no-such-model")).toBeUndefined();
  });

  it("invalid token counts price at zero instead of NaN", () => {
    const rates = { input: 2, output: 4 };
    expect(calculateDollarCost({ input: Number.NaN, output: 100 }, rates)).toBe(
      0,
    );
    expect(calculateDollarCost({ input: -5, output: 100 }, rates)).toBe(0);
  });

  it("both tools declare their names and required parameters", () => {
    const search = createWebSearchTool();
    const fetch = createWebFetchTool();
    expect(search.name).toBe("web_search");
    expect(fetch.name).toBe("web_fetch");
    expect(search.parameters.required).toContain("query");
    expect(fetch.parameters.required).toContain("url");
  });
});
