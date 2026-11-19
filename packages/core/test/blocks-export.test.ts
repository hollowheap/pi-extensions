import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("the blocks module is part of core's public surface", () => {
  it("exposes callable block helpers from the core barrel", () => {
    expect(typeof core.scanTaggedBlocks).toBe("function");
    expect(typeof core.parseMarkdownBlocks).toBe("function");
    expect(core.scanTaggedBlocks("'''q\nx\n'''")).toHaveLength(1);
    expect(core.parseMarkdownBlocks("# H")).toEqual([
      { type: "heading", depth: 1, text: "H" },
    ]);
  });
});

describe("barrel contract and robustness seams", () => {
  it("the blocks module imports no host-only packages", () => {
    const source = readFileSync(
      new URL("../src/blocks.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("@earendil-works");
    expect(source).not.toContain("typebox");
  });

  it("barrel block helpers tolerate hostile input without throwing", () => {
    for (const input of ["", "'''", "\u0000'''question\n'''", "```\n'''"]) {
      expect(() => core.scanTaggedBlocks(input)).not.toThrow();
      expect(() => core.parseMarkdownBlocks(input)).not.toThrow();
    }
  });

  it("the barrel parse helper exposes unchecked checkbox state", () => {
    expect(core.parseMarkdownBlocks("1. [ ] Open")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [{ type: "listItem", text: "Open", checked: false }],
      },
    ]);
  });
});
