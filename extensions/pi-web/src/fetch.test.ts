import { describe, expect, it, vi } from "vitest";
import { fetchUrl, rawFetch } from "./fetch.js";
import type {
  NormalizedFetchResult,
  ProviderAdapter,
} from "./providers/types.js";

function provider(
  id: ProviderAdapter["id"],
  fetchImpl: ProviderAdapter["fetch"],
): ProviderAdapter {
  return {
    id,
    name: id,
    capabilities: { search: true, fetch: true },
    search: async () => [],
    fetch: fetchImpl,
  };
}

function result(
  providerId: NormalizedFetchResult["provider"],
  content: string,
): NormalizedFetchResult {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com/final",
    provider: providerId,
    contentType: "text/plain",
    content,
    links: [],
    media: [],
    truncated: false,
  };
}

describe("fetchUrl", () => {
  it("uses the first provider that returns content", async () => {
    const raw = vi.fn();
    const exa = vi.fn().mockResolvedValue(result("exa", "from exa"));
    const fetchResult = await fetchUrl("https://example.com", {
      providers: [provider("exa", exa)],
      fetchImpl: raw,
    });

    expect(fetchResult.provider).toBe("exa");
    expect(fetchResult.content).toBe("from exa");
    expect(raw).not.toHaveBeenCalled();
  });

  it("falls through provider failures and empty content", async () => {
    const exa = vi.fn().mockRejectedValue(new Error("offline"));
    const tavily = vi.fn().mockResolvedValue(result("tavily", "from tavily"));
    const fetchResult = await fetchUrl("https://example.com", {
      providers: [provider("exa", exa), provider("tavily", tavily)],
    });

    expect(fetchResult.provider).toBe("tavily");
    expect(fetchResult.content).toBe("from tavily");
    expect(exa).toHaveBeenCalledTimes(1);
    expect(tavily).toHaveBeenCalledTimes(1);
  });

  it("falls back to raw HTML extraction", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response(
        "<html><head><title>Doc</title></head><body><h1>Hi</h1><a href='/x'>X</a><img src='/i.png'></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      ),
    );
    const fetchResult = await fetchUrl("https://example.com", {
      providers: [],
      fetchImpl: raw,
    });

    expect(fetchResult.provider).toBe("raw");
    expect(fetchResult.finalUrl).toBe("https://example.com");
    expect(fetchResult.content).toContain("# Hi");
    expect(fetchResult.links).toEqual([
      { url: "https://example.com/x", text: "X" },
    ]);
    expect(fetchResult.media[0]?.url).toBe("https://example.com/i.png");
  });

  it("passes text through and leaves non-text content empty", async () => {
    const text = vi.fn().mockResolvedValue(
      new Response("hello", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const textResult = await fetchUrl("https://example.com", {
      providers: [],
      fetchImpl: text,
    });
    expect(textResult.content).toBe("hello");
    expect(textResult.links).toEqual([]);

    const binary = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    const binaryResult = await fetchUrl("https://example.com", {
      providers: [],
      fetchImpl: binary,
    });
    expect(binaryResult.content).toBe("");
    expect(binaryResult.contentType).toBe("application/octet-stream");
  });

  it("reports raw HTTP failures", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response("nope", {
        status: 500,
        statusText: "Server Error",
        headers: { "content-type": "text/plain" },
      }),
    );
    await expect(
      fetchUrl("https://example.com", { providers: [], fetchImpl: raw }),
    ).rejects.toThrow("raw fetch failed: 500");
  });

  it("rawFetch follows redirects and keeps the final URL", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const fetchResult = await rawFetch("https://example.com/start", {
      fetchImpl: raw,
    });
    expect(fetchResult.finalUrl).toBe("https://example.com/start");
    expect(raw).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({ redirect: "follow" }),
    );
  });
});
