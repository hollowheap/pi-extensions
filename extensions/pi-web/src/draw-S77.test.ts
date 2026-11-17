import { describe, expect, it, vi } from "vitest";
import { ExaAdapter } from "./providers/exa.js";
import { FirecrawlAdapter } from "./providers/firecrawl.js";
import { TavilyAdapter } from "./providers/tavily.js";

describe("S77: provider adapters return normalized results", () => {
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
});
