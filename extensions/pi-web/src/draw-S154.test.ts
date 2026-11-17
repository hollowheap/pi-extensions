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
});
