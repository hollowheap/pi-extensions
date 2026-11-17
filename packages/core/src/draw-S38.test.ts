import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks } from "./blocks.js";

describe("S38: parseMarkdownBlocks yields heading/list/listItem/paragraph nodes", () => {
  it("parses ordered checklists without inline parsing and never throws on malformed input", () => {
    expect(
      parseMarkdownBlocks(
        "## Pick one\n\n1. [x] Alpha\n2. Beta\n\nsome **bold** text",
      ),
    ).toEqual([
      { type: "heading", depth: 2, text: "Pick one" },
      {
        type: "list",
        ordered: true,
        items: [
          { type: "listItem", text: "Alpha", checked: true },
          { type: "listItem", text: "Beta" },
        ],
      },
      { type: "paragraph", text: "some **bold** text" },
    ]);

    expect(() =>
      parseMarkdownBlocks("####### bad\n- [Z] weird\n"),
    ).not.toThrow();
  });
});
