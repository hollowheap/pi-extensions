import { describe, expect, it, vi } from "vitest";
import { searchKeyless } from "../src/keyless.js";

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

  it("keeps each snippet with its own result when an earlier result has none", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          `<a class="result__a" href="https://a.test">A</a>
           <a class="result__a" href="https://b.test">B</a>
           <a class="result__snippet">Beta snippet</a>`,
          { headers: { "content-type": "text/html" } },
        ),
    );
    const results = await searchKeyless(
      { query: "q", maxResults: 5 },
      fetchImpl,
    );
    expect(results).toEqual([
      {
        title: "A",
        url: "https://a.test/",
        snippet: "",
        provider: "duckduckgo",
      },
      {
        title: "B",
        url: "https://b.test/",
        snippet: "Beta snippet",
        provider: "duckduckgo",
      },
    ]);
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
