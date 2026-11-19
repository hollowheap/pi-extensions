import { describe, expect, it, vi } from "vitest";
import { withProviderFallback } from "../../src/providers/selection.js";

describe("provider fallback on empty results", () => {
  it("advances to the next provider when one returns no results", async () => {
    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      return provider === "a" ? [] : ["hit"];
    });

    expect(result).toEqual(["hit"]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("exhausting every provider with empty results returns empty", async () => {
    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      return [];
    });

    expect(result).toEqual([]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("an attempted provider error also advances the fallback", async () => {
    const seen: string[] = [];
    const result = await withProviderFallback(["a", "b"], async (provider) => {
      seen.push(provider);
      if (provider === "a") throw new Error("provider a down");
      return ["recovered"];
    });

    expect(result).toEqual(["recovered"]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("an already-aborted signal prevents any provider attempt", async () => {
    const attempt = vi.fn(async () => ["unused"]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(
      withProviderFallback(["a", "b"], attempt, controller.signal),
    ).rejects.toThrow(/aborted/);
    expect(attempt).not.toHaveBeenCalled();
  });
});
