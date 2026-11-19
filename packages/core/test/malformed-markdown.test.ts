import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks, scanTaggedBlocks } from "../src/blocks.js";

describe("malformed input never throws", () => {
  it("tolerates hostile and incomplete markdown", () => {
    const inputs = [
      "",
      "'''",
      "'''question",
      "'''question\n",
      "```\n'''",
      "\u0000'''question\n'''",
    ];
    for (const input of inputs) {
      expect(() => scanTaggedBlocks(input)).not.toThrow();
    }
    expect(scanTaggedBlocks("'''question\n'''")).toEqual([
      { tag: "question", body: "", start: 0, end: 15, closed: true },
    ]);
  });
});

describe("nested fence, tilde, and composition seams", () => {
  it("a code fence inside a block body does not close it early", () => {
    const markdown = "'''question\n```js\ncode\n```\n'''";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "```js\ncode\n```",
        start: 0,
        end: markdown.length,
        closed: true,
      },
    ]);
  });

  it("tilde-delimited tagged blocks are recognized and closed", () => {
    const markdown = "~~~question\nbody\n~~~";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "body",
        start: 0,
        end: markdown.length,
        closed: true,
      },
    ]);
  });

  it("hostile block bodies still parse without throwing", () => {
    const blocks = scanTaggedBlocks("'''question\n\u0000\n- [Z] x\n'''");
    expect(blocks).toHaveLength(1);
    expect(() => parseMarkdownBlocks(blocks[0]?.body ?? "")).not.toThrow();
    expect(parseMarkdownBlocks(blocks[0]?.body ?? "")).toHaveLength(2);
  });
});
