import { describe, expect, it, vi } from "vitest";
import {
  FETCH_DEFAULT_CHARS,
  FETCH_MAX_LINKS,
  FETCH_MAX_MEDIA,
  SEARCH_DEFAULT_RESULTS,
  SEARCH_MAX_RESULTS,
  createWebFetchTool,
  createWebSearchTool,
} from "../src/tools.js";

describe("web tools return normalized fields under enforced caps", () => {
  it("normalizes and truncates search results", async () => {
    const search = vi.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({
        title: `t${i}`,
        url: `https://example.com/${i}`,
        snippet: `s${i}`,
      })),
    );
    const tool = createWebSearchTool({ search });
    const result = await tool.execute(
      "1",
      { query: "q" },
      undefined,
      undefined,
      {} as never,
    );
    const details = result.details as {
      results: unknown[];
      truncated: boolean;
    };
    expect(details.results).toHaveLength(SEARCH_DEFAULT_RESULTS);
    expect(details.truncated).toBe(true);
    expect(SEARCH_MAX_RESULTS).toBe(10);
  });

  it("caps fetch content, links, and media", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      provider: "exa",
      contentType: "text/html",
      content: "x".repeat(FETCH_DEFAULT_CHARS + 100),
      links: Array.from({ length: FETCH_MAX_LINKS + 10 }, (_, i) => ({
        url: `https://example.com/l${i}`,
        text: `l${i}`,
      })),
      media: Array.from({ length: FETCH_MAX_MEDIA + 5 }, (_, i) => ({
        url: `https://example.com/m${i}`,
        kind: "image" as const,
      })),
      truncated: false,
    });
    const tool = createWebFetchTool({ fetch });
    const result = await tool.execute(
      "1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );
    const details = result.details as {
      content: string;
      links: unknown[];
      media: unknown[];
      truncated: boolean;
    };
    expect(details.content).toHaveLength(FETCH_DEFAULT_CHARS);
    expect(details.links).toHaveLength(FETCH_MAX_LINKS);
    expect(details.media).toHaveLength(FETCH_MAX_MEDIA);
    expect(details.truncated).toBe(true);
  });

  it("clamps max_results to the hard maximum", async () => {
    const search = vi.fn().mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        title: `t${i}`,
        url: `https://example.com/${i}`,
        snippet: `s${i}`,
      })),
    );
    const tool = createWebSearchTool({ search });
    const result = await tool.execute(
      "1",
      { query: "q", max_results: 15 } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect((result.details as { results: unknown[] }).results).toHaveLength(
      SEARCH_MAX_RESULTS,
    );
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: SEARCH_MAX_RESULTS }),
    );
  });

  it("reports a search provider failure as tool error text", async () => {
    const search = vi.fn().mockRejectedValue(new Error("provider down"));
    const tool = createWebSearchTool({ search });
    const result = await tool.execute(
      "1",
      { query: "q" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "web_search unavailable",
    );
    expect(result.details).toMatchObject({ error: "provider down" });
  });

  it("drops unsafe search result URLs before normalizing", async () => {
    const search = vi.fn().mockResolvedValue([
      { title: "ok", url: "https://example.com/a", snippet: "a" },
      { title: "private", url: "http://127.0.0.1/secret", snippet: "b" },
    ]);
    const tool = createWebSearchTool({ search });
    const result = await tool.execute(
      "1",
      { query: "q" } as never,
      undefined,
      undefined,
      {} as never,
    );
    const results = (result.details as { results: Array<{ url: string }> })
      .results;
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/a");
  });
});
