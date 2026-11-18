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

  it("S86 C02: reports a fetch provider failure as tool error text", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("host unreachable"));
    const tool = createWebFetchTool({ fetch });
    const result = await tool.execute(
      "1",
      { url: "https://example.com" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "web_fetch unavailable",
    );
    expect(result.details).toMatchObject({ error: "host unreachable" });
  });

  it("S86 C03: honors max_chars and flags truncation", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      contentType: "text/html",
      content: "abcdefghij",
      links: [],
      media: [],
      truncated: false,
    });
    const tool = createWebFetchTool({ fetch });
    const result = await tool.execute(
      "1",
      { url: "https://example.com", max_chars: 4 } as never,
      undefined,
      undefined,
      {} as never,
    );
    const details = result.details as { content: string; truncated: boolean };
    expect(details.content).toBe("abcd");
    expect(details.truncated).toBe(true);
  });

  it("S86 C04: drops data URLs and preserves the final URL", async () => {
    const fetch = vi.fn().mockResolvedValue({
      url: "https://example.com/start",
      finalUrl: "https://example.com/done",
      contentType: "text/html",
      content: "text",
      links: [
        { url: "https://example.com/ok", text: "ok" },
        { url: "data:text/html,x", text: "bad" },
      ],
      media: [
        {
          url: "data:image/png;base64,x",
          kind: "image",
          mimeType: "image/png",
        },
      ],
      truncated: false,
    });
    const tool = createWebFetchTool({ fetch });
    const result = await tool.execute(
      "1",
      { url: "https://example.com/start" } as never,
      undefined,
      undefined,
      {} as never,
    );
    const details = result.details as {
      finalUrl: string;
      links: Array<{ url: string }>;
      media: Array<{ url: string }>;
    };
    expect(details.finalUrl).toBe("https://example.com/done");
    expect(details.links.map((link) => link.url)).toEqual([
      "https://example.com/ok",
    ]);
    expect(details.media).toEqual([]);
  });
});
