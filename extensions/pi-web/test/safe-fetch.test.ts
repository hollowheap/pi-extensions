import { describe, expect, it, vi } from "vitest";
import { safeFetchResponse } from "../src/safe-fetch.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function redirectResponse(location?: string): Response {
  return new Response(null, {
    status: 302,
    headers: location ? { location } : {},
  });
}

describe("safeFetchResponse", () => {
  it("follows redirects manually and returns the last requested URL", async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      requested.push(String(input));
      if (requested.length === 1) return redirectResponse("/next");
      return new Response("ok", { status: 200 });
    });
    const signal = new AbortController().signal;

    const result = await safeFetchResponse("https://example.com/start", {
      fetchImpl,
      signal,
      headers: { Accept: "text/plain" },
      resolveHost: publicResolver,
    });

    expect(result.url).toBe("https://example.com/next");
    expect(requested).toEqual([
      "https://example.com/start",
      "https://example.com/next",
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/start",
      expect.objectContaining({
        signal,
        redirect: "manual",
        headers: { Accept: "text/plain" },
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/next",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("rejects unsafe redirect targets and cancels the redirect body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    );

    await expect(
      safeFetchResponse("https://example.com/start", {
        fetchImpl,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/not allowed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(true);
  });

  it("rejects redirects without a Location header", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 302 }));

    await expect(
      safeFetchResponse("https://example.com/start", {
        fetchImpl,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow("redirect missing Location header");
    expect(cancelled).toBe(true);
  });

  it("caps redirects at five", async () => {
    const fetchImpl = vi.fn(async () => redirectResponse("/next"));

    await expect(
      safeFetchResponse("https://example.com/start", {
        fetchImpl,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow("too many redirects");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
