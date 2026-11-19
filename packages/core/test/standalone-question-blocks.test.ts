import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "../src/blocks.js";

describe("question blocks are recognized only as standalone tagged blocks", () => {
  it("finds a valid question block with exact offsets and ignores fenced impostors", () => {
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

    const fenced = ["```", "'''question", "not a block", "'''", "```"].join(
      "\n",
    );
    expect(scanTaggedBlocks(fenced)).toEqual([]);
  });
});

describe("offset, multi-block, and ordering seams", () => {
  it("CRLF line endings keep carriage returns out of the body", () => {
    const markdown = "before\r\n'''question\r\nbody\r\n'''\r\nafter";
    const blocks = scanTaggedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.tag).toBe("question");
    expect(blocks[0]?.body).toBe("body");
    expect(blocks[0]?.closed).toBe(true);
    expect(blocks[0]?.body).not.toContain("\r");
    expect(markdown.slice(blocks[0]?.start, blocks[0]?.end)).toContain(
      "'''question",
    );
  });

  it("a closed block followed by an untracked tag reports both states", () => {
    const markdown = "'''question\nA\n'''\n'''other\nB";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "A",
        start: 0,
        end: markdown.indexOf("'''other") - 1,
        closed: true,
      },
      {
        tag: "other",
        body: "B",
        start: markdown.indexOf("'''other"),
        end: markdown.length,
        closed: false,
      },
    ]);
  });

  it("multiple blocks occupy non-overlapping source slices in order", () => {
    const markdown = "'''first\na\n'''\nmid\n'''second\nb\n'''";
    const blocks = scanTaggedBlocks(markdown);
    expect(blocks.map((b) => b.tag)).toEqual(["first", "second"]);
    expect(blocks[0]?.end).toBeLessThan(blocks[1]?.start ?? 0);
    expect(markdown.slice(blocks[0]?.start, blocks[0]?.end)).toBe(
      "'''first\na\n'''",
    );
    expect(markdown.slice(blocks[1]?.start, blocks[1]?.end)).toBe(
      "'''second\nb\n'''",
    );
  });
});
