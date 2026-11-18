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

  it("S169 C02: an empty image body yields an explanatory text result", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(), {
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const result = await rawFetch("https://example.com/empty.jpg", {
      fetchImpl: raw,
      resolveHost: publicResolver,
    });

    expect(result.image).toBeUndefined();
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("Image exceeds the 2 MB content limit");
  });

  it("S169 C03: a private resolved address is rejected before the image is fetched", async () => {
    const raw = vi.fn();
    const privateResolver = async () => [{ address: "10.0.0.5", family: 4 }];

    await expect(
      rawFetch("https://example.com/pic.png", {
        fetchImpl: raw,
        resolveHost: privateResolver,
      }),
    ).rejects.toThrow(/not allowed/);
    expect(raw).not.toHaveBeenCalled();
  });

  it("S169 C04: a text response stays text instead of becoming an image block", async () => {
    const raw = vi.fn().mockResolvedValue(
      new Response("plain text body", {
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await rawFetch("https://example.com/note.txt", {
      fetchImpl: raw,
      resolveHost: publicResolver,
    });

    expect(result.image).toBeUndefined();
    expect(result.content).toBe("plain text body");
  });
});
