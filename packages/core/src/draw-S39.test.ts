import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("S39: the blocks module is part of core's public surface", () => {
  it("exposes callable block helpers from the core barrel", () => {
    expect(typeof core.scanTaggedBlocks).toBe("function");
    expect(typeof core.parseMarkdownBlocks).toBe("function");
    expect(core.scanTaggedBlocks("'''q\nx\n'''")).toHaveLength(1);
    expect(core.parseMarkdownBlocks("# H")).toEqual([
      { type: "heading", depth: 1, text: "H" },
    ]);
  });
});
