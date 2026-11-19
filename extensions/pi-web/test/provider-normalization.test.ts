import { describe, expect, it, vi } from "vitest";
import { ExaAdapter } from "../src/providers/exa.js";
import { FirecrawlAdapter } from "../src/providers/firecrawl.js";
import { TavilyAdapter } from "../src/providers/tavily.js";

describe("provider adapters return normalized results", () => {
  it("normalizes Tavily, Exa, and Firecrawl search payloads", async () => {
    const json = {
      results: [
        {
          title: "T",
          url: "https://example.com",
          content: "snippet",
          text: "snippet",
        },
      ],
    };
    const okResponse = () => ({
      ok: true,
      json: async () => json,
    });
    for (const Adapter of [TavilyAdapter, ExaAdapter, FirecrawlAdapter]) {
      const adapter = new Adapter({
        fetchImpl: vi.fn().mockResolvedValue(okResponse()) as never,
      });
      const results = await adapter.search({ query: "q", apiKey: "k" });
      expect(results[0]).toMatchObject({
        title: "T",
        url: "https://example.com",
        snippet: "snippet",
      });
      expect(typeof results[0].provider).toBe("string");
    }
  });

  it("rejects non-OK provider responses with a provider error", async () => {
    const failed = () => ({
      ok: false,
      status: 503,
      statusText: "Unavailable",
    });
    for (const Adapter of [TavilyAdapter, ExaAdapter, FirecrawlAdapter]) {
      const adapter = new Adapter({
        fetchImpl: vi.fn().mockResolvedValue(failed()) as never,
      });
      await expect(adapter.search({ query: "q", apiKey: "k" })).rejects.toThrow(
        /search failed/,
      );
    }
  });

  it("exposes only the capabilities each provider supports", () => {
    const tavily = new TavilyAdapter();
    const exa = new ExaAdapter();
    const firecrawl = new FirecrawlAdapter();
    expect(tavily.capabilities).toMatchObject({ search: true, fetch: true });
    expect(exa.capabilities).toMatchObject({ search: true, fetch: true });
    expect(firecrawl.capabilities).toMatchObject({
      search: true,
      fetch: false,
    });
    expect((firecrawl as unknown as { fetch?: unknown }).fetch).toBeUndefined();
  });

  it("tags normalized results with the adapter provider id", async () => {
    const json = {
      results: [{ title: "T", url: "https://example.com", content: "s" }],
    };
    const pairs = [
      [TavilyAdapter, "tavily"],
      [ExaAdapter, "exa"],
      [FirecrawlAdapter, "firecrawl"],
    ] as const;
    for (const [Adapter, id] of pairs) {
      const adapter = new Adapter({
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => json,
        }) as never,
      });
      const results = await adapter.search({ query: "q", apiKey: "k" });
      expect(results[0].provider).toBe(id);
    }
  });
});
