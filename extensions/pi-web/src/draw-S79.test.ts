import { describe, expect, it } from "vitest";
import {
  FETCH_ORDER,
  PROVIDER_TIMEOUT_MS,
  SEARCH_ORDER,
  hasProviderKey,
  resolveFetchOrder,
  resolveSearchOrder,
  withProviderFallback,
} from "./providers/selection.js";

describe("S79: provider selection auto-detects keys and falls through", () => {
  it("uses cheapest-first orders, honors config, and advances on failure", async () => {
    expect(SEARCH_ORDER).toEqual(["exa", "tavily", "firecrawl"]);
    expect(FETCH_ORDER).toEqual(["exa", "tavily", "raw"]);
    expect(PROVIDER_TIMEOUT_MS).toBe(15_000);
    expect(hasProviderKey("raw", {})).toBe(true);
    expect(resolveSearchOrder(["firecrawl", "exa", "exa", "unknown"], {
      EXA_API_KEY: "x",
      FIRECRAWL_API_KEY: "z",
    })).toEqual(["firecrawl", "exa"]);
    expect(resolveFetchOrder(undefined, {})).toEqual(["raw"]);

    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      if (provider === "a") throw new Error("first failed");
      return provider;
    });
    expect(result).toBe("b");
    expect(seen).toEqual(["a", "b"]);
  });
});
