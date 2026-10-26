import { describe, expect, it, vi } from "vitest";
import {
  TAVILY_EXTRACT_URL,
  TAVILY_SEARCH_URL,
  TavilyAdapter,
} from "./tavily.js";
import type { NormalizedFetchResult } from "./types.js";

describe("TavilyAdapter", () => {
  it("parses search results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "T", url: "https://example.com", content: "snippet" },
        ],
      }),
    });
    const adapter = new TavilyAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q", apiKey: "k" });
    expect(results).toEqual([
      {
        title: "T",
        url: "https://example.com",
        snippet: "snippet",
        provider: "tavily",
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TAVILY_SEARCH_URL);
    expect(init.headers).toMatchObject({ Authorization: "Bearer k" });
    expect(JSON.parse(init.body as string)).toEqual({
      query: "q",
      max_results: 5,
    });
  });

  it("handles missing fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{}] }),
    });
    const adapter = new TavilyAdapter({ fetchImpl: fetchMock as never });
    const results = await adapter.search({ query: "q" });
    expect(results[0]).toMatchObject({
      title: "",
      url: "",
      snippet: "",
      provider: "tavily",
    });
  });

  it("throws on HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    const adapter = new TavilyAdapter({ fetchImpl: fetchMock as never });
    await expect(adapter.search({ query: "q" })).rejects.toThrow();
  });

  it("parses fetch/extract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ url: "https://example.com", raw_content: "content" }],
      }),
    });
    const adapter = new TavilyAdapter({ fetchImpl: fetchMock as never });
    const result = (await adapter.fetch?.({
      url: "https://example.com",
      apiKey: "k",
    })) as NormalizedFetchResult;
    expect(result.content).toBe("content");
    expect(result.provider).toBe("tavily");
    expect(result.links).toEqual([]);
    expect(result.media).toEqual([]);
    expect(result.truncated).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TAVILY_EXTRACT_URL);
    expect(init.headers).toMatchObject({ Authorization: "Bearer k" });
    expect(JSON.parse(init.body as string)).toEqual({
      urls: ["https://example.com"],
    });
  });
});
