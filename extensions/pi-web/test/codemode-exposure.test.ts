import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "../src/tools.js";

describe("both web tools declare codemode exposure", () => {
  it("does not expose either tool as a direct model tool", () => {
    expect(createWebSearchTool().exposure).toBe("codemode");
    expect(createWebFetchTool().exposure).toBe("codemode");
  });

  it("declares distinct tool names and input schemas", () => {
    const search = createWebSearchTool();
    const fetch = createWebFetchTool();
    expect(search.name).toBe("web_search");
    expect(fetch.name).toBe("web_fetch");
    const searchParams = search.parameters as {
      properties: Record<string, unknown>;
    };
    const fetchParams = fetch.parameters as {
      properties: Record<string, unknown>;
    };
    expect(searchParams.properties).toHaveProperty("query");
    expect(searchParams.properties).toHaveProperty("max_results");
    expect(fetchParams.properties).toHaveProperty("url");
    expect(fetchParams.properties).toHaveProperty("max_chars");
  });

  it("returns an error result for empty query and url", async () => {
    const search = createWebSearchTool();
    const fetch = createWebFetchTool();
    const s = await search.execute(
      "1",
      { query: "   " } as never,
      undefined,
      undefined,
      {} as never,
    );
    const f = await fetch.execute(
      "1",
      { url: "   " } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect((s.content as Array<{ text: string }>)[0].text).toContain(
      "query is required",
    );
    expect((f.content as Array<{ text: string }>)[0].text).toContain(
      "url is required",
    );
    expect(s.details).toMatchObject({ error: expect.any(String) });
    expect(f.details).toMatchObject({ error: expect.any(String) });
  });

  it("rejects non-positive limits before calling providers", async () => {
    const searchProvider = vi.fn();
    const fetchProvider = vi.fn();
    const search = createWebSearchTool({ search: searchProvider as never });
    const fetch = createWebFetchTool({ fetch: fetchProvider as never });
    const s = await search.execute(
      "1",
      { query: "q", max_results: 0 } as never,
      undefined,
      undefined,
      {} as never,
    );
    const f = await fetch.execute(
      "1",
      { url: "https://example.com", max_chars: -1 } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect((s.content as Array<{ text: string }>)[0].text).toContain(
      "max_results must be a positive integer",
    );
    expect((f.content as Array<{ text: string }>)[0].text).toContain(
      "max_chars must be a positive integer",
    );
    expect(searchProvider).not.toHaveBeenCalled();
    expect(fetchProvider).not.toHaveBeenCalled();
  });
});
