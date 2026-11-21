import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  fetchMediaPreview,
  getMediaPreview,
  setMediaPreview,
} from "../src/media.js";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("media previews", () => {
  it("fetches and caches bounded image bytes", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(pngBytes, {
          headers: { "content-type": "image/png" },
        }),
    );

    const preview = await fetchMediaPreview(
      "https://example.com/pic.png",
      undefined,
      fetchImpl,
      publicResolver,
    );

    expect(preview).toEqual({
      data: pngBytes.toString("base64"),
      mimeType: "image/png",
    });
    expect(getMediaPreview("https://example.com/pic.png")).toEqual(preview);
  });

  it("follows safe redirects and caches under the original URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/final.png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(pngBytes, {
          headers: { "content-type": "image/png" },
        }),
      );

    const preview = await fetchMediaPreview(
      "https://example.com/start",
      undefined,
      fetchImpl,
      publicResolver,
    );

    expect(preview).toEqual({
      data: pngBytes.toString("base64"),
      mimeType: "image/png",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://example.com/final.png",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(getMediaPreview("https://example.com/start")).toEqual(preview);
  });

  it("returns undefined for redirect failures but rejects unsafe targets", async () => {
    const missingLocation = vi.fn(
      async () => new Response(null, { status: 302 }),
    );
    const looping = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "/next" },
        }),
    );
    const unsafe = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        }),
    );

    await expect(
      fetchMediaPreview(
        "https://example.com/missing",
        undefined,
        missingLocation,
        publicResolver,
      ),
    ).resolves.toBeUndefined();
    await expect(
      fetchMediaPreview(
        "https://example.com/loop",
        undefined,
        looping,
        publicResolver,
      ),
    ).resolves.toBeUndefined();
    expect(looping).toHaveBeenCalledTimes(6);
    await expect(
      fetchMediaPreview(
        "https://example.com/unsafe",
        undefined,
        unsafe,
        publicResolver,
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it("rejects non-image responses and oversized images", async () => {
    const textFetch = vi.fn(
      async () =>
        new Response("not an image", {
          headers: { "content-type": "text/plain" },
        }),
    );
    const largeFetch = vi.fn(
      async () =>
        new Response(pngBytes, {
          headers: {
            "content-type": "image/png",
            "content-length": String(3 * 1024 * 1024),
          },
        }),
    );

    await expect(
      fetchMediaPreview(
        "https://example.com/a.txt",
        undefined,
        textFetch,
        publicResolver,
      ),
    ).resolves.toBeUndefined();
    await expect(
      fetchMediaPreview(
        "https://example.com/large.png",
        undefined,
        largeFetch,
        publicResolver,
      ),
    ).resolves.toBeUndefined();
  });

  it("stores explicit previews for renderers", () => {
    setMediaPreview("https://example.com/manual.png", {
      data: "abc",
      mimeType: "image/png",
    });
    expect(getMediaPreview("https://example.com/manual.png")).toEqual({
      data: "abc",
      mimeType: "image/png",
    });
  });
});
