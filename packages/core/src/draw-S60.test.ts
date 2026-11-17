import { describe, expect, it } from "vitest";
import { scanTaggedBlocks } from "./blocks.js";

describe("S60: malformed input never throws", () => {
  it("tolerates hostile and incomplete markdown", () => {
    const inputs = ["", "'''", "'''question", "'''question\n", "```\n'''", "\u0000'''question\n'''"];
    for (const input of inputs) {
      expect(() => scanTaggedBlocks(input)).not.toThrow();
    }
    expect(scanTaggedBlocks("'''question\n'''")).toEqual([
      { tag: "question", body: "", start: 0, end: 15, closed: true },
    ]);
  });
});
