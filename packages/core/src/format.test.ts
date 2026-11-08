import { describe, expect, it } from "vitest";
import { displayPath, displayTarget, truncateText } from "./format.js";

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("short")).toBe("short");
    expect(truncateText("x".repeat(4000))).toBe("x".repeat(4000));
  });

  it("keeps 3000 head and 1000 tail characters", () => {
    const text = `${"a".repeat(3000)}${"b".repeat(1000)}${"c".repeat(1000)}`;
    const result = truncateText(text);
    expect(result).toBe(
      `${"a".repeat(3000)}\n[truncated: cut 1000 characters]\n${"c".repeat(1000)}`,
    );
  });

  it("accepts a caller label", () => {
    expect(truncateText("x".repeat(5000), "acp")).toContain(
      "[acp: cut 1000 characters]",
    );
  });
});

describe("displayTarget", () => {
  it("truncates past 500 characters with an ellipsis", () => {
    const target = "x".repeat(600);
    expect(displayTarget(target)).toBe(`${"x".repeat(500)}…`);
    expect(displayTarget("x".repeat(500))).toBe("x".repeat(500));
  });
});

describe("displayPath", () => {
  it("returns a posix relative path", () => {
    expect(displayPath("/work", "/work/src/a.ts")).toBe("src/a.ts");
    expect(displayPath("/work", "/work/")).toBe("");
    expect(displayPath("/work", "/other/a.ts")).toBe("../other/a.ts");
  });
});

describe("sanitizeTerminalText", () => {
  it("removes CSI, OSC, ESC, and C0/C1 control bytes while keeping newline and tab", async () => {
    const { sanitizeTerminalText } = await import("./format.js");
    const dirty =
      "hello\t\x1b[31mred\x1b[0m\n" +
      "\x1b]0;pwned-title\x07" +
      "\x1b]52;c;YWJj\x1b\\" +
      "line2\r\x00\x07\x08\x1b[2J\x9b32mok\x85\x9fend";
    expect(sanitizeTerminalText(dirty)).toBe("hello\tred\nline2okend");
  });

  it("preserves 16-color, 256-color, and TrueColor SGR sequences when allowSgr is true while stripping control sequences", async () => {
    const { sanitizeTerminalText } = await import("./format.js");
    const input =
      "\x1b[31m16-color\x1b[0m " +
      "\x1b[38;5;208m256-color\x1b[0m " +
      "\x1b[38;2;255;100;0mTrueColor\x1b[0m\n" +
      "\x1b]52;c;ZXZpbA==\x07" +
      "\x1b]2;title\x07" +
      "\x1b[2J\x1b[H\x1b[?25l" +
      "\x00\x07\x08clean";
    const expected =
      "\x1b[31m16-color\x1b[0m " +
      "\x1b[38;5;208m256-color\x1b[0m " +
      "\x1b[38;2;255;100;0mTrueColor\x1b[0m\n" +
      "clean";
    expect(sanitizeTerminalText(input, { allowSgr: true })).toBe(expected);
  });
});
