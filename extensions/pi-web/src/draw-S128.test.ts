import { describe, expect, it, vi } from "vitest";
import { fetchUrl, rawFetch } from "./fetch.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function response(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("S128 caching and content negotiation", () => {
  it("serves repeated raw fetches from cache and sets the Accept header", async () => {
    const fetchImpl = vi.fn(async () => response("cached body", "text/plain"));
    const options = {
      providers: [],
      cacheTtlMs: 60_000,
      fetchImpl: fetchImpl as never,
      resolveHost: publicResolver,
    };
    expect(
      (await fetchUrl("https://example.com/s128-cache", options)).content,
    ).toBe("cached body");
    expect(
      (await fetchUrl("https://example.com/s128-cache", options)).content,
    ).toBe("cached body");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const jsonFetch = vi.fn(
      async (_url: unknown, _init: { headers: Record<string, string> }) =>
        response("{}", "application/json"),
    );
    await rawFetch("https://example.com/s128-accept", {
      fetchImpl: jsonFetch as never,
      acceptType: "json",
      resolveHost: publicResolver,
    });
    expect(jsonFetch.mock.calls[0][1].headers.Accept).toBe("application/json");
  });

  it("S128 C02: different accept types keep separate cache entries", async () => {
    const url = `https://example.com/s128-key-${Date.now()}`;
    const fetchImpl = vi.fn(async () => response("body", "text/plain"));
    const options = {
      providers: [],
      cacheTtlMs: 60_000,
      fetchImpl: fetchImpl as never,
      resolveHost: publicResolver,
    };
    await fetchUrl(url, { ...options, acceptType: "text" });
    await fetchUrl(url, { ...options, acceptType: "text" });
    await fetchUrl(url, { ...options, acceptType: "json" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("S128 C03: unsafe URLs are rejected before any network call", async () => {
    const fetchImpl = vi.fn(async () => response("body", "text/plain"));
    await expect(
      fetchUrl("file:///etc/passwd", { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("URL must use http or https");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("S128 C04: a provider result short-circuits the raw fetch path", async () => {
    const fetchImpl = vi.fn(async () => response("raw", "text/plain"));
    const provider = {
      id: "exa" as const,
      name: "fake",
      capabilities: { search: false, fetch: true },
      search: vi.fn(async () => []),
      fetch: vi.fn(async () => ({
        url: "https://example.com/s128-provider",
        finalUrl: "https://example.com/s128-provider",
        provider: "exa" as const,
        contentType: "text/plain",
        content: "provider body",
        links: [],
        media: [],
        truncated: false,
      })),
    };
    const result = await fetchUrl("https://example.com/s128-provider", {
      providers: [provider],
      fetchImpl: fetchImpl as never,
      resolveHost: publicResolver,
    });
    expect(result.content).toBe("provider body");
    expect(result.provider).toBe("exa");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
