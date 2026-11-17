import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "./tools.js";

describe("S85: repeated calls always invoke the provider again", () => {
  it("has no module-level response cache for search or fetch", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const searchTool = createWebSearchTool({ search });
    await searchTool.execute("1", { query: "q" }, undefined, undefined, {} as never);
    await searchTool.execute("2", { query: "q" }, undefined, undefined, {} as never);
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
    await fetchTool.execute("1", { url: "https://example.com" }, undefined, undefined, {} as never);
    await fetchTool.execute("2", { url: "https://example.com" }, undefined, undefined, {} as never);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
