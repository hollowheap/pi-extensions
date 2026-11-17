import { describe, expect, it } from "vitest";
import { sanitizeTerminalText } from "./format.js";

describe("S186 terminal text sanitization", () => {
  it("removes OSC and CSI control bytes while keeping newline and tab", () => {
    const dirty =
      "hello\t\x1b[31mred\x1b[0m\n" +
      "\x1b]0;pwned-title\x07" +
      "line2\r\x00\x07\x08\x1b[2J\x9b32mok\x85\x9fend";

    expect(sanitizeTerminalText(dirty)).toBe("hello\tred\nline2okend");
  });
});
