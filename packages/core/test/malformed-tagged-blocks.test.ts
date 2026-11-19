import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "../src/blocks.js";

describe("unknown and malformed blocks are ignored without throwing", () => {
  it("returns no blocks for unknown tags and malformed or indented openings", () => {
    expect(scanTaggedBlocks("'''Unknown\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("'''Question\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("'''question extra\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("  '''question\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("")).toEqual([]);
  });
});

describe("empty, recovery, and tag-charset seams", () => {
  it("a closed empty block is returned rather than discarded", () => {
    expect(scanTaggedBlocks("'''question\n'''")).toEqual([
      { tag: "question", body: "", start: 0, end: 15, closed: true },
    ]);
  });

  it("a fake tag inside a fence is inert but a real block after it survives", () => {
    const markdown = "```\n'''question\nfake\n```\n'''question\nreal\n'''";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "real",
        start: markdown.indexOf("'''question\nreal"),
        end: markdown.length,
        closed: true,
      },
    ]);
  });

  it("lowercase tags may contain digits and underscores", () => {
    const markdown = "'''my_tag2\nx\n'''";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "my_tag2",
        body: "x",
        start: 0,
        end: markdown.length,
        closed: true,
      },
    ]);
    expect(scanTaggedBlocks("'''2tag\nx\n'''")).toEqual([]);
  });
});
