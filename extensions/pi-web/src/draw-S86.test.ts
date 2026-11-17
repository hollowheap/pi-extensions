import { describe, expect, it, vi } from "vitest";
import {
  FETCH_MAX_LINKS,
  FETCH_MAX_MEDIA,
  createWebFetchTool,
} from "./tools.js";

describe("S86: fetch returns Markdown with bounded links and media metadata", () => {
  it("caps links and media and emits metadata without binary payloads", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      content: "# Title\n\ntext",
      links: Array.from({ length: FETCH_MAX_LINKS + 5 }, (_, i) => ({
        url: `https://example.com/l${i}`,
        text: `l${i}`,
      })),
      media: Array.from({ length: FETCH_MAX_MEDIA + 5 }, (_, i) => ({
        url: `https://example.com/m${i}.png`,
        kind: "image" as const,
        alt: `a${i}`,
        mimeType: "image/png",
      })),
      truncated: false,
    });
    const tool = createWebFetchTool({ fetch });
    const result = await tool.execute(
      "1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {} as never,
    );
    const details = result.details as {
      content: string;
      links: unknown[];
      media: Array<Record<string, unknown>>;
    };
    expect(details.content).toContain("# Title");
    expect(typeof details.content).toBe("string");
    expect(details.links).toHaveLength(FETCH_MAX_LINKS);
    expect(details.media).toHaveLength(FETCH_MAX_MEDIA);
    expect(details.media[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
    });
  });
});
