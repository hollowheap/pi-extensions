import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks, scanTaggedBlocks } from "./blocks.js";
import * as core from "./index.js";

describe("scanTaggedBlocks", () => {
  it("finds a tagged block and reports exact offsets", () => {
    const markdown = "before\n'''question\n## Pick\n1. A\n'''\nafter";
    const blocks = scanTaggedBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      tag: "question",
      body: "## Pick\n1. A",
      start: 7,
      end: 35,
      closed: true,
    });
    expect(markdown.slice(blocks[0].start, blocks[0].end)).toBe(
      "'''question\n## Pick\n1. A\n'''",
    );
  });

  it("finds multiple blocks and keeps their order", () => {
    const markdown = "'''question\nQ1\n'''\nmid\n'''create_todos\n- [ ] a\n'''";
    const blocks = scanTaggedBlocks(markdown);

    expect(blocks.map((block) => block.tag)).toEqual([
      "question",
      "create_todos",
    ]);
    expect(blocks.map((block) => block.body)).toEqual(["Q1", "- [ ] a"]);
  });

  it("returns an unclosed block through EOF", () => {
    const markdown = "'''question\n## Q";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "## Q",
        start: 0,
        end: markdown.length,
        closed: false,
      },
    ]);
  });

  it("allows an empty body", () => {
    expect(scanTaggedBlocks("'''question\n'''")).toEqual([
      { tag: "question", body: "", start: 0, end: 15, closed: true },
    ]);
  });

  it("ignores tagged lines inside markdown code fences", () => {
    const markdown = [
      "```",
      "'''question",
      "not a block",
      "'''",
      "```",
      "~~~",
      "'''create_todos",
      "'''",
      "~~~",
      "'''question",
      "real",
      "'''",
    ].join("\n");

    const blocks = scanTaggedBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ tag: "question", body: "real" });
  });

  it("does not close a block on a tagged line inside a body code fence", () => {
    const markdown = "'''question\n```\n'''\n```\n'''";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "```\n'''\n```",
        start: 0,
        end: markdown.length,
        closed: true,
      },
    ]);
  });

  it("ignores malformed opening lines", () => {
    expect(scanTaggedBlocks("'''Question\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("'''question extra\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("  '''question\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("")).toEqual([]);
  });

  it("finds tagged blocks delimited by backticks and tildes", () => {
    const markdown =
      "```create_todos\n1. Task\n```\n~~~\n'''ignored\n~~~\n```complete_todos\n1. 1\n```";
    const blocks = scanTaggedBlocks(markdown);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      tag: "create_todos",
      body: "1. Task",
      closed: true,
    });
    expect(blocks[1]).toMatchObject({
      tag: "complete_todos",
      body: "1. 1",
      closed: true,
    });
  });

  it("requires matching closing delimiter for backticks and single quotes", () => {
    expect(scanTaggedBlocks("```create_todos\n1. Task\n'''\n```")).toEqual([
      {
        tag: "create_todos",
        body: "1. Task\n'''",
        start: 0,
        end: 31,
        closed: true,
      },
    ]);
  });
});

describe("parseMarkdownBlocks", () => {
  it("parses headings in source order", () => {
    expect(parseMarkdownBlocks("## Pick one\n# Top")).toEqual([
      { type: "heading", depth: 2, text: "Pick one" },
      { type: "heading", depth: 1, text: "Top" },
    ]);
  });

  it("parses ordered lists with checkbox state", () => {
    expect(parseMarkdownBlocks("1. [ ] A\n2. [x] B\n3. C")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          { type: "listItem", text: "A", checked: false },
          { type: "listItem", text: "B", checked: true },
          { type: "listItem", text: "C" },
        ],
      },
    ]);
  });

  it("parses unordered lists and groups mixed markers", () => {
    expect(parseMarkdownBlocks("- A\n* B\n+ C")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          { type: "listItem", text: "A" },
          { type: "listItem", text: "B" },
          { type: "listItem", text: "C" },
        ],
      },
    ]);
  });

  it("groups consecutive non-list lines into paragraphs", () => {
    expect(parseMarkdownBlocks("alpha\nbeta\n\ngamma")).toEqual([
      { type: "paragraph", text: "alpha beta" },
      { type: "paragraph", text: "gamma" },
    ]);
  });

  it("keeps headings, lists, and paragraphs in source order", () => {
    expect(parseMarkdownBlocks("## Pick\n1. A\n2. B\n\nnote")).toEqual([
      { type: "heading", depth: 2, text: "Pick" },
      {
        type: "list",
        ordered: true,
        items: [
          { type: "listItem", text: "A" },
          { type: "listItem", text: "B" },
        ],
      },
      { type: "paragraph", text: "note" },
    ]);
  });

  it("does not throw on malformed input", () => {
    expect(() => parseMarkdownBlocks("###\n1.\n[x]\n```")).not.toThrow();
  });
});

describe("core blocks exports", () => {
  it("exports both public functions from the barrel", () => {
    expect(core.scanTaggedBlocks).toBe(scanTaggedBlocks);
    expect(core.parseMarkdownBlocks).toBe(parseMarkdownBlocks);
  });
});
