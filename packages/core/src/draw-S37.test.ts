import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks, scanTaggedBlocks } from "./blocks.js";

describe("S37: scanTaggedBlocks locates '''tag blocks with exact offsets", () => {
  it("reports tag/body/start/end/closed, ignores code fences, and handles multiple or unclosed blocks", () => {
    const markdown = "before\n'''question\n## Pick\n1. A\n'''\nafter";
    const blocks = scanTaggedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      tag: "question",
      body: "## Pick\n1. A",
      closed: true,
    });
    expect(markdown.slice(blocks[0].start, blocks[0].end)).toBe(
      "'''question\n## Pick\n1. A\n'''",
    );

    expect(scanTaggedBlocks("```\n'''question\nbody\n'''\n```")).toEqual([]);

    const mixed = scanTaggedBlocks("'''a\nX\n'''\n'''b\nY");
    expect(mixed.map((block) => [block.tag, block.closed])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});

describe("delimiter, recovery, and composed seams", () => {
  it("S37 C02: backtick-delimited tagged blocks with CRLF endings report raw offsets", () => {
    const markdown = "```question\r\nbody\r\n```";
    const blocks = scanTaggedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      tag: "question",
      body: "body",
      start: 0,
      closed: true,
    });
    expect(blocks[0].end).toBe(markdown.length);
    expect(markdown.slice(blocks[0].start, blocks[0].end)).toBe(markdown);
  });

  it("S37 C03: a tagged block after a closed markdown fence is still discovered", () => {
    const markdown = "```\nnot a block\n```\n'''question\nreal\n'''";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "real",
        start: markdown.indexOf("'''question"),
        end: markdown.length,
        closed: true,
      },
    ]);
  });

  it("S37 C04: a scanned block body parses into heading and list nodes", () => {
    const markdown = "'''question\n## Pick\n1. A\n'''";
    const block = scanTaggedBlocks(markdown)[0];
    expect(block).toBeDefined();
    expect(parseMarkdownBlocks(block?.body ?? "")).toEqual([
      { type: "heading", depth: 2, text: "Pick" },
      {
        type: "list",
        ordered: true,
        items: [{ type: "listItem", text: "A" }],
      },
    ]);
  });
});
