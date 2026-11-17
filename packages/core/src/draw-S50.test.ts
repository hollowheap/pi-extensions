import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "./blocks.js";

describe("S50: unknown and malformed blocks are ignored without throwing", () => {
  it("returns no blocks for unknown tags and malformed or indented openings", () => {
    expect(scanTaggedBlocks("'''Unknown\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("'''Question\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("'''question extra\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("  '''question\nx\n'''")).toEqual([]);
    expect(scanTaggedBlocks("")).toEqual([]);
  });
});
