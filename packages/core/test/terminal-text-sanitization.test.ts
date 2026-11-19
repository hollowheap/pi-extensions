import { describe, expect, it } from "vitest";
import { renderAgentRoster } from "../src/agents.js";
import { sanitizeTerminalText } from "../src/format.js";

describe("terminal text sanitization", () => {
  it("removes OSC and CSI control bytes while keeping newline and tab", () => {
    const dirty =
      "hello\t\x1b[31mred\x1b[0m\n" +
      "\x1b]0;pwned-title\x07" +
      "line2\r\x00\x07\x08\x1b[2J\x9b32mok\x85\x9fend";

    expect(sanitizeTerminalText(dirty)).toBe("hello\tred\nline2okend");
  });

  it("text with no control bytes is returned unchanged", () => {
    const plain = "plain text: a, b; c\nsecond line\twith tab";
    expect(sanitizeTerminalText(plain)).toBe(plain);
  });

  it("allowSgr keeps valid SGR color sequences but still strips OSC", () => {
    const text = "\x1b[31mred\x1b[0m\x1b]0;title\x07tail";
    expect(sanitizeTerminalText(text, { allowSgr: true })).toBe(
      "\x1b[31mred\x1b[0mtail",
    );
  });

  it("agent roster rendering sanitizes hostile agent names", () => {
    const rendered = renderAgentRoster([
      { name: "evil\x1b]0;pwn\x07name", description: "ok\x00bad" },
    ]);
    expect(rendered).toContain("evilname");
    expect(rendered).not.toContain("\x1b");
    expect(rendered).not.toContain("\x00");
  });
});
