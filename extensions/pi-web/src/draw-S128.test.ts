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

    const jsonFetch = vi.fn(async () => response("{}", "application/json"));
    await rawFetch("https://example.com/s128-accept", {
      fetchImpl: jsonFetch as never,
      acceptType: "json",
      resolveHost: publicResolver,
    });
    expect(jsonFetch.mock.calls[0][1].headers.Accept).toBe("application/json");
  });
});
