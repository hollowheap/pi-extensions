import { describe, expect, it, vi } from "vitest";
import {
  createWebFetchTool,
  createWebSearchTool,
  getWebSessionState,
} from "./tools.js";

describe("S85: repeated calls always invoke the provider again", () => {
  it("has no module-level response cache for search or fetch", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const searchTool = createWebSearchTool({ search });
    await searchTool.execute(
      "1",
      { query: "q" },
      undefined,
      undefined,
      {} as never,
    );
    await searchTool.execute(
      "2",
      { query: "q" },
      undefined,
      undefined,
      {} as never,
    );
    expect(search).toHaveBeenCalledTimes(2);

    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      content: "hello",
      links: [],
      media: [],
      truncated: false,
    });
    const fetchTool = createWebFetchTool({ fetch });
    await fetchTool.execute(
      "1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );
    await fetchTool.execute(
      "2",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("S85 C02: forwards each distinct query to the provider unchanged", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const tool = createWebSearchTool({ search });
    await tool.execute(
      "1",
      { query: "alpha" } as never,
      undefined,
      undefined,
      {} as never,
    );
    await tool.execute(
      "2",
      { query: "beta" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect(search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ query: "alpha" }),
    );
    expect(search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ query: "beta" }),
    );
  });

  it("S85 C03: does not cache a provider failure", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([
        { title: "ok", url: "https://example.com", snippet: "s" },
      ]);
    const tool = createWebSearchTool({ search });
    const first = await tool.execute(
      "1",
      { query: "q" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect(first.details).toMatchObject({ error: "down" });
    const second = await tool.execute(
      "2",
      { query: "q" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect((second.details as { results: unknown[] }).results).toHaveLength(1);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("S85 C04: counts each call in the web session state", async () => {
    const sessionManager = {};
    const search = vi.fn().mockResolvedValue([]);
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      content: "x",
      links: [],
      media: [],
      truncated: false,
    });
    const searchTool = createWebSearchTool({ search });
    const fetchTool = createWebFetchTool({ fetch });
    await searchTool.execute(
      "1",
      { query: "q" } as never,
      undefined,
      undefined,
      { sessionManager } as never,
    );
    await fetchTool.execute(
      "2",
      { url: "https://example.com" } as never,
      undefined,
      undefined,
      { sessionManager } as never,
    );
    const state = getWebSessionState(sessionManager);
    expect(state.searchCount).toBe(1);
    expect(state.fetchCount).toBe(1);
  });
});
