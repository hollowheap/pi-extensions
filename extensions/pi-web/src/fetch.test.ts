import { describe, expect, it, vi } from "vitest";
import { MAX_RESPONSE_BYTES, fetchUrl, rawFetch } from "./fetch.js";
import type {
  FetchRequest,
  NormalizedFetchResult,
  ProviderAdapter,
} from "./providers/types.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

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
      resolveHost: publicResolver,
    });

    expect(fetchResult.provider).toBe("exa");
    expect(fetchResult.content).toBe("from exa");
    expect(raw).not.toHaveBeenCalled();
  });

  it("isolates cached results by provider set and API key", async () => {
    const exa = vi.fn().mockResolvedValue(result("exa", "exa content"));
    const tavily = vi
      .fn()
      .mockResolvedValue(result("tavily", "tavily content"));

    const first = await fetchUrl("https://example.com/cache-isolation", {
      providers: [provider("exa", exa)],
      apiKey: "first-key",
      cacheTtlMs: 60_000,
    });
    const second = await fetchUrl("https://example.com/cache-isolation", {
      providers: [provider("tavily", tavily)],
      apiKey: "second-key",
      cacheTtlMs: 60_000,
    });

    expect(first.content).toBe("exa content");
    expect(second.content).toBe("tavily content");
    expect(exa).toHaveBeenCalledTimes(1);
    expect(tavily).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest cached result", async () => {
    const fetch = vi.fn(async (request: FetchRequest) =>
      result("exa", request.url),
    );
    const adapter = provider("exa", fetch);
    const options = {
      providers: [adapter],
      cacheTtlMs: 60_000,
    };

    for (let index = 0; index < 33; index++) {
      await fetchUrl(`https://example.com/cache-${index}`, options);
    }
    await fetchUrl("https://example.com/cache-0", options);

    expect(fetch).toHaveBeenCalledTimes(34);
  });

  it("queues concurrent rate-limited requests", async () => {
    const starts: number[] = [];
    const fetch = vi.fn(async (request: FetchRequest) => {
      starts.push(Date.now());
      return result("exa", request.url);
    });
    const adapter = provider("exa", fetch);

    await Promise.all([
      fetchUrl("https://example.com/rate-1", {
        providers: [adapter],
        rateLimitMs: 40,
      }),
      fetchUrl("https://example.com/rate-2", {
        providers: [adapter],
        rateLimitMs: 40,
      }),
    ]);

    expect(starts).toHaveLength(2);
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(25);
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
      resolveHost: publicResolver,
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
      resolveHost: publicResolver,
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
      resolveHost: publicResolver,
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
      fetchUrl("https://example.com", {
        providers: [],
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow("raw fetch failed: 500");
  });

  it("stops on caller abort instead of falling through", async () => {
    const controller = new AbortController();
    controller.abort();
    const providerFetch = vi.fn();
    await expect(
      fetchUrl("https://example.com", {
        providers: [provider("exa", providerFetch)],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe initial URLs before fetching", async () => {
    const raw = vi.fn();
    await expect(
      rawFetch("http://127.0.0.1", { fetchImpl: raw }),
    ).rejects.toThrow(/not allowed/);
    expect(raw).not.toHaveBeenCalled();
  });

  it("rejects redirects to private targets", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    await expect(
      rawFetch("https://example.com", {
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("bounds response bodies", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response("x".repeat(MAX_RESPONSE_BYTES + 10), {
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await rawFetch("https://example.com", {
      fetchImpl: raw,
      resolveHost: publicResolver,
    });

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(MAX_RESPONSE_BYTES);
  });

  it("cancels redirect bodies before rejecting unsafe locations", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const raw = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    );

    await expect(
      rawFetch("https://example.com", {
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/not allowed/);
    expect(cancelled).toBe(true);
  });

  it("cancels non-OK response bodies", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const raw = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 500,
        statusText: "Server Error",
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      rawFetch("https://example.com", {
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow("raw fetch failed: 500");
    expect(cancelled).toBe(true);
  });

  it("caps redirects at five", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "/next" },
      }),
    );
    await expect(
      rawFetch("https://example.com", {
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/too many redirects/);
    expect(raw).toHaveBeenCalledTimes(6);
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
      resolveHost: publicResolver,
    });
    expect(fetchResult.finalUrl).toBe("https://example.com/start");
    expect(raw).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
