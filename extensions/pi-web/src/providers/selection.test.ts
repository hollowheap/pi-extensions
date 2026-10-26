import { describe, expect, it } from "vitest";
import {
  FETCH_ORDER,
  PROVIDER_TIMEOUT_MS,
  SEARCH_ORDER,
  hasProviderKey,
  providerEnvKey,
  providerSignal,
  resolveFetchOrder,
  resolveSearchOrder,
  withProviderFallback,
} from "./selection.js";

describe("provider selection", () => {
  it("uses the documented fixed orders and timeout", () => {
    expect(SEARCH_ORDER).toEqual(["exa", "tavily", "firecrawl"]);
    expect(FETCH_ORDER).toEqual(["exa", "tavily", "raw"]);
    expect(PROVIDER_TIMEOUT_MS).toBe(15_000);
  });

  it("detects configured keys and trims blanks", () => {
    expect(providerEnvKey("exa")).toBe("EXA_API_KEY");
    expect(hasProviderKey("exa", { EXA_API_KEY: " key " })).toBe(true);
    expect(hasProviderKey("exa", { EXA_API_KEY: "   " })).toBe(false);
    expect(hasProviderKey("exa", {})).toBe(false);
    expect(hasProviderKey("raw", {})).toBe(true);
  });

  it("filters default search order by key presence", () => {
    expect(
      resolveSearchOrder(undefined, {
        EXA_API_KEY: "x",
        FIRECRAWL_API_KEY: "z",
      }),
    ).toEqual(["exa", "firecrawl"]);
    expect(resolveSearchOrder(undefined, {})).toEqual([]);
  });

  it("lets a configured search order win and skips invalid or unkeyed entries", () => {
    expect(
      resolveSearchOrder(["firecrawl", "exa", "exa", "unknown", "tavily"], {
        EXA_API_KEY: "x",
        FIRECRAWL_API_KEY: "z",
      }),
    ).toEqual(["firecrawl", "exa"]);
    expect(resolveSearchOrder(["tavily"], {})).toEqual([]);
  });

  it("keeps raw available and respects configured fetch order", () => {
    expect(resolveFetchOrder(undefined, {})).toEqual(["raw"]);
    expect(
      resolveFetchOrder(undefined, {
        EXA_API_KEY: "x",
        TAVILY_API_KEY: "y",
      }),
    ).toEqual(["exa", "tavily", "raw"]);
    expect(
      resolveFetchOrder(["raw", "tavily", "exa"], { EXA_API_KEY: "x" }),
    ).toEqual(["raw", "exa"]);
  });

  it("falls through provider failures and stops on abort", async () => {
    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      if (provider === "a") throw new Error("first failed");
      return provider;
    });
    expect(result).toBe("b");
    expect(seen).toEqual(["a", "b"]);

    await expect(
      withProviderFallback(["a"], async () => {
        throw new Error("last failed");
      }),
    ).rejects.toThrow("last failed");

    const controller = new AbortController();
    controller.abort();
    await expect(
      withProviderFallback(["a"], async () => "never", controller.signal),
    ).rejects.toThrow(/abort/i);
  });

  it("combines caller abort with the provider timeout", () => {
    expect(providerSignal(AbortSignal.abort()).aborted).toBe(true);
    expect(providerSignal()).toBeInstanceOf(AbortSignal);
  });
});
