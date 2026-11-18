import { describe, expect, it, vi } from "vitest";
import { MAX_RESPONSE_BYTES, rawFetch } from "./fetch.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("S154 response body cap", () => {
  it("stops reading at the byte cap and reports truncation", async () => {
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

  it("S154 C02: a body ending exactly at the cap is not reported as truncated", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response("y".repeat(MAX_RESPONSE_BYTES), {
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await rawFetch("https://example.com", {
      fetchImpl: raw,
      resolveHost: publicResolver,
    });

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(MAX_RESPONSE_BYTES);
  });

  it("S154 C03: a non-OK response fails before any body content is returned", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response("failure details", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      rawFetch("https://example.com", {
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/raw fetch failed: 503/);
  });

  it("S154 C04: an unsafe target is rejected before the fetch is issued", async () => {
    const raw = vi.fn();

    await expect(
      rawFetch("https://127.0.0.1", {
        fetchImpl: raw,
        resolveHost: publicResolver,
      }),
    ).rejects.toThrow(/not allowed/);
    expect(raw).not.toHaveBeenCalled();
  });
});
