import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "./blocks.js";

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
