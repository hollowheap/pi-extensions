import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "./blocks.js";

describe("S46: question blocks are recognized only as standalone tagged blocks", () => {
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

    const fenced = ["```", "'''question", "not a block", "'''", "```"].join("\n");
    expect(scanTaggedBlocks(fenced)).toEqual([]);
  });
});
