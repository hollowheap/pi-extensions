import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  fetchMediaPreview,
  getMediaPreview,
  setMediaPreview,
} from "./media.js";

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
