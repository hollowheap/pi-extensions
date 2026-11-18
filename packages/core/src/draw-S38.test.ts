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

describe("list, degradation, and whitespace seams", () => {
  it("S38 C02: unordered items carry checkbox state for both x cases", () => {
    expect(parseMarkdownBlocks("- [x] Done\n- [ ] Open\n- plain")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          { type: "listItem", text: "Done", checked: true },
          { type: "listItem", text: "Open", checked: false },
          { type: "listItem", text: "plain" },
        ],
      },
    ]);
  });

  it("S38 C03: malformed heading depth and checkbox markers degrade to literal text", () => {
    expect(parseMarkdownBlocks("####### bad\n- [Z] weird\n")).toEqual([
      { type: "paragraph", text: "####### bad" },
      {
        type: "list",
        ordered: false,
        items: [{ type: "listItem", text: "[Z] weird" }],
      },
    ]);
  });

  it("S38 C04: CRLF paragraphs join with spaces and blank lines split lists", () => {
    expect(
      parseMarkdownBlocks(
        "alpha\r\nbeta\r\n\r\n1. one\r\n2. two\r\n\r\n2. three",
      ),
    ).toEqual([
      { type: "paragraph", text: "alpha beta" },
      {
        type: "list",
        ordered: true,
        items: [
          { type: "listItem", text: "one" },
          { type: "listItem", text: "two" },
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [{ type: "listItem", text: "three" }],
      },
    ]);
  });
});
