import { describe, expect, it, vi } from "vitest";
import { rawFetch } from "./fetch.js";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("S169 direct image fetch", () => {
  it("returns one bounded image block carrying the MIME type", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const raw = vi
      .fn()
      .mockResolvedValue(
        new Response(bytes, { headers: { "content-type": "image/png" } }),
      );

    const result = await rawFetch("https://example.com/pic.png", {
      fetchImpl: raw,
      resolveHost: publicResolver,
    });

    expect(result.image?.mimeType).toBe("image/png");
    expect(Buffer.from(result.image?.data ?? "", "base64")).toEqual(
      Buffer.from(bytes),
    );
    expect(result.content).toBe("");
  });
});
