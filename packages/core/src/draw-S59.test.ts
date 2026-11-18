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

describe("CRLF, fence precedence, and near-miss seams", () => {
  it("S59 C02: a CRLF unclosed block spans to EOF with a normalized body", () => {
    const markdown = "'''question\r\n## Q";
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

  it("S59 C03: an unterminated code fence suppresses the tag inside it", () => {
    expect(scanTaggedBlocks("```\n'''question\nstub")).toEqual([]);
  });

  it("S59 C04: a close candidate with trailing text does not end the block", () => {
    const markdown = "'''question\nA\n''' note\nB";
    expect(scanTaggedBlocks(markdown)).toEqual([
      {
        tag: "question",
        body: "A\n''' note\nB",
        start: 0,
        end: markdown.length,
        closed: false,
      },
    ]);
  });
});
