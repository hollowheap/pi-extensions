import { describe, expect, it, vi } from "vitest";
import { FIRECRAWL_SEARCH_URL, FirecrawlAdapter } from "./firecrawl.js";

describe("FirecrawlAdapter", () => {
  it("parses search results from data.web", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          web: [
            { title: "T", url: "https://example.com", description: "snippet" },
          ],
        },
      }),
    });
    const adapter = new FirecrawlAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q", apiKey: "k" });
    expect(results[0]).toMatchObject({
      title: "T",
      url: "https://example.com",
      snippet: "snippet",
      provider: "firecrawl",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FIRECRAWL_SEARCH_URL);
    expect(init.headers).toMatchObject({ Authorization: "Bearer k" });
    expect(JSON.parse(init.body as string)).toEqual({
      query: "q",
      limit: 5,
    });
  });

  it("parses search results from data array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { title: "T", url: "https://example.com", description: "snippet" },
        ],
      }),
    });
    const adapter = new FirecrawlAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q" });
    expect(results).toHaveLength(1);
  });

  it("handles missing fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{}] }),
    });
    const adapter = new FirecrawlAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q" });
    expect(results[0]).toMatchObject({
      title: "",
      url: "",
      snippet: "",
      provider: "firecrawl",
    });
  });

  it("throws on HTTP error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });
    const adapter = new FirecrawlAdapter({ fetchImpl: fetchMock as never });
    await expect(adapter.search({ query: "q" })).rejects.toThrow();
  });

  it("has no fetch capability", () => {
    const adapter = new FirecrawlAdapter();
    expect(adapter.capabilities.fetch).toBe(false);
    expect((adapter as { fetch?: unknown }).fetch).toBeUndefined();
  });
});
