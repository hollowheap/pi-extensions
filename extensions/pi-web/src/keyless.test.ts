import { describe, expect, it, vi } from "vitest";
import { searchKeyless } from "./keyless.js";

const html = `
<html><body>
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">A &amp; B</a>
  <a class="result__snippet" href="https://example.com/a">First <b>snippet</b></a>
</div>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Second</a>
  <a class="result__snippet" href="https://example.com/b">Second snippet</a>
</div>
</body></html>`;

describe("searchKeyless", () => {
  it("parses DuckDuckGo HTML results without an API key", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(html, {
          headers: { "content-type": "text/html" },
        }),
    );
    const results = await searchKeyless(
      { query: "docs", maxResults: 1 },
      fetchImpl,
    );

    expect(results).toEqual([
      {
        title: "A & B",
        url: "https://example.com/a",
        snippet: "First snippet",
        provider: "duckduckgo",
      },
    ]);
    const requested = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(requested.searchParams.get("q")).toBe("docs");
  });

  it("returns an empty list for empty HTML and reports HTTP failures", async () => {
    const empty = vi.fn(
      async () => new Response("<html></html>", { status: 200 }),
    );
    await expect(
      searchKeyless({ query: "none", maxResults: 5 }, empty),
    ).resolves.toEqual([]);

    const failed = vi.fn(async () => new Response("blocked", { status: 429 }));
    await expect(
      searchKeyless({ query: "blocked", maxResults: 5 }, failed),
    ).rejects.toThrow(/keyless search failed: 429/);
  });
});
