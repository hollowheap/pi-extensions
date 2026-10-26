import { describe, expect, it, vi } from "vitest";
import {
  FETCH_DEFAULT_CHARS,
  FETCH_MAX_CHARS,
  FETCH_MAX_LINKS,
  FETCH_MAX_MEDIA,
  SEARCH_DEFAULT_RESULTS,
  SEARCH_MAX_RESULTS,
  createWebFetchTool,
  createWebSearchTool,
} from "./tools.js";

function textOf(result: { content: unknown }): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

function detailsOf(result: { details: unknown }): Record<string, unknown> {
  return result.details as Record<string, unknown>;
}

function searchResult(index: number) {
  return {
    title: `t${index}`,
    url: `https://example.com/${index}`,
    snippet: `s${index}`,
    provider: "exa" as const,
  };
}

describe("web_search", () => {
  it("returns normalized results with the default limit", async () => {
    const search = vi
      .fn()
      .mockResolvedValue(
        Array.from({ length: 7 }, (_, index) => searchResult(index)),
      );
    const tool = createWebSearchTool({ search });
    const result = await tool.execute(
      "1",
      { query: "q" },
      undefined,
      undefined,
      {} as never,
    );
    const details = detailsOf(result);
    expect(details.results).toHaveLength(SEARCH_DEFAULT_RESULTS);
    expect(
      (details.results as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      title: "t0",
      url: "https://example.com/0",
      snippet: "s0",
      provider: "exa",
    });
    expect(details.truncated).toBe(true);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "q",
        maxResults: SEARCH_DEFAULT_RESULTS,
      }),
    );
  });

  it("caps max_results at 10", async () => {
    const search = vi
      .fn()
      .mockResolvedValue(
        Array.from({ length: 15 }, (_, index) => searchResult(index)),
      );
    const tool = createWebSearchTool({ search });
    const result = await tool.execute(
      "1",
      { query: "q", max_results: 15 },
      undefined,
      undefined,
      {} as never,
    );
    expect(detailsOf(result).results).toHaveLength(SEARCH_MAX_RESULTS);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: SEARCH_MAX_RESULTS }),
    );
  });

  it("returns text for invalid input and provider errors", async () => {
    const search = vi.fn();
    const tool = createWebSearchTool({ search });
    const empty = await tool.execute(
      "1",
      { query: "" },
      undefined,
      undefined,
      {} as never,
    );
    expect(textOf(empty)).toContain("query is required");
    expect(search).not.toHaveBeenCalled();

    const invalid = await tool.execute(
      "1",
      { query: "q", max_results: 0 },
      undefined,
      undefined,
      {} as never,
    );
    expect(textOf(invalid)).toContain("positive integer");

    const failing = createWebSearchTool({
      search: vi.fn().mockRejectedValue(new Error("provider down")),
    });
    const failed = await failing.execute(
      "1",
      { query: "q" },
      undefined,
      undefined,
      {} as never,
    );
    expect(textOf(failed)).toContain("provider down");
  });

  it("does not cache repeated searches", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const tool = createWebSearchTool({ search });
    await tool.execute("1", { query: "q" }, undefined, undefined, {} as never);
    await tool.execute("2", { query: "q" }, undefined, undefined, {} as never);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe("web_fetch", () => {
  it("caps content, links, and media and reports truncation", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com/final",
      provider: "exa",
      contentType: "text/html",
      content: "x".repeat(25_000),
      links: Array.from({ length: 60 }, (_, index) => ({
        url: `https://example.com/l${index}`,
        text: `l${index}`,
      })),
      media: Array.from({ length: 25 }, (_, index) => ({
        url: `https://example.com/m${index}`,
        kind: "image" as const,
        alt: `a${index}`,
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
    const details = detailsOf(result);
    expect((details.content as string).length).toBe(FETCH_DEFAULT_CHARS);
    expect(details.links).toHaveLength(FETCH_MAX_LINKS);
    expect(details.media).toHaveLength(FETCH_MAX_MEDIA);
    expect(details.truncated).toBe(true);
    expect(details.finalUrl).toBe("https://example.com/final");
    expect(details.provider).toBe("exa");
  });

  it("caps max_chars at 100k", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      provider: "raw",
      contentType: "text/plain",
      content: "y".repeat(150_000),
      links: [],
      media: [],
      truncated: false,
    });
    const tool = createWebFetchTool({ fetch });
    const result = await tool.execute(
      "1",
      { url: "https://example.com", max_chars: 150_000 },
      undefined,
      undefined,
      {} as never,
    );
    const details = detailsOf(result);
    expect((details.content as string).length).toBe(FETCH_MAX_CHARS);
    expect(details.truncated).toBe(true);
  });

  it("returns text for invalid input and provider errors", async () => {
    const fetch = vi.fn();
    const tool = createWebFetchTool({ fetch });
    const empty = await tool.execute(
      "1",
      { url: "" },
      undefined,
      undefined,
      {} as never,
    );
    expect(textOf(empty)).toContain("url is required");
    expect(fetch).not.toHaveBeenCalled();

    const invalid = await tool.execute(
      "1",
      { url: "https://example.com", max_chars: 0 },
      undefined,
      undefined,
      {} as never,
    );
    expect(textOf(invalid)).toContain("positive integer");

    const failing = createWebFetchTool({
      fetch: vi.fn().mockRejectedValue(new Error("fetch failed")),
    });
    const failed = await failing.execute(
      "1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );
    expect(textOf(failed)).toContain("fetch failed");
  });
});
