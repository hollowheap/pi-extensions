import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "./blocks.js";

describe("S59: a streaming open question block is reported through EOF", () => {
  it("returns an unclosed block while keeping markdown code fences inert", () => {
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

    expect(scanTaggedBlocks("```\n'''question\nstub\n```")).toEqual([]);
  });
});
