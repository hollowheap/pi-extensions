import { describe, expect, it } from "vitest";
import {
  FETCH_ORDER,
  PROVIDER_TIMEOUT_MS,
  SEARCH_ORDER,
  hasProviderKey,
  resolveFetchOrder,
  resolveSearchOrder,
  withProviderFallback,
} from "../src/providers/selection.js";

describe("provider selection auto-detects keys and falls through", () => {
  it("uses cheapest-first orders, honors config, and advances on failure", async () => {
    expect(SEARCH_ORDER).toEqual(["exa", "tavily", "firecrawl"]);
    expect(FETCH_ORDER).toEqual(["exa", "tavily", "raw"]);
    expect(PROVIDER_TIMEOUT_MS).toBe(15_000);
    expect(hasProviderKey("raw", {})).toBe(true);
    expect(
      resolveSearchOrder(["firecrawl", "exa", "exa", "unknown"], {
        EXA_API_KEY: "x",
        FIRECRAWL_API_KEY: "z",
      }),
    ).toEqual(["firecrawl", "exa"]);
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

  it("treats blank and whitespace env keys as absent", () => {
    expect(hasProviderKey("exa", { EXA_API_KEY: "   " })).toBe(false);
    expect(hasProviderKey("exa", { EXA_API_KEY: "" })).toBe(false);
    expect(hasProviderKey("exa", { EXA_API_KEY: "k" })).toBe(true);
    expect(hasProviderKey("raw", {})).toBe(true);
    expect(hasProviderKey("nope" as never, {})).toBe(false);
  });

  it("propagates the last provider error and honors abort", async () => {
    await expect(
      withProviderFallback(["a", "b"], async (provider) => {
        throw new Error(`failed ${provider}`);
      }),
    ).rejects.toThrow("failed b");
    const controller = new AbortController();
    controller.abort();
    await expect(
      withProviderFallback(["a"], async () => "x", controller.signal),
    ).rejects.toThrow(/aborted/);
  });

  it("advances past an empty result to the next provider", async () => {
    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      return provider === "a" ? [] : ["hit"];
    });
    expect(result).toEqual(["hit"]);
    expect(seen).toEqual(["a", "b"]);
  });
});
