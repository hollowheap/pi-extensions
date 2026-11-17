import { describe, expect, it } from "vitest";
import { withProviderFallback } from "./selection.js";

describe("S155 provider fallback on empty results", () => {
  it("advances to the next provider when one returns no results", async () => {
    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      return provider === "a" ? [] : ["hit"];
    });

    expect(result).toEqual(["hit"]);
    expect(seen).toEqual(["a", "b"]);
  });
});
