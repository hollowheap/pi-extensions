import { highlightCode, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { markdownTheme } from "../src/markdown.js";

const passthrough = (text: string) => text;
const theme = {
  fg: (_token: string, text: string) => text,
  bold: passthrough,
  italic: passthrough,
  underline: passthrough,
  strikethrough: passthrough,
} as never;

describe("host Markdown and syntax highlighting", () => {
  it("renders headings, inline spans, quotes, nested lists, task lists, and tables", () => {
    const content = [
      "# Heading",
      "A **bold** and *italic* [link](https://example.com) with `inline code`.",
      "> Quoted text",
      "1. Parent\n   - Child\n- [x] Complete",
      "| Item | State |\n| --- | --- |\n| Table cell | Ready |",
      "---",
    ].join("\n\n");
    const rendered = stripTerminalSequences(
      new Markdown(content, 0, 0, markdownTheme(theme, false))
        .render(80)
        .join("\n"),
    );
    for (const expected of [
      "Heading",
      "bold",
      "italic",
      "link",
      "inline code",
      "Quoted text",
      "Parent",
      "Child",
      "[x] Complete",
      "Table cell",
      "Ready",
      "│",
    ]) {
      expect(rendered).toContain(expected);
    }
  });

  it.each([
    ["ts", "const answer: number = 42;"],
    ["python", "def f(): return 42"],
    ["rust", "fn main() { let x = 42; }"],
    ["bash", 'echo "$HOME"'],
    ["json", '{"ok": true}'],
  ])("uses Pi's native highlighting for %s fences", (language, code) => {
    initTheme("dark");
    const rendered = new Markdown(
      `\`\`\`${language}\n${code}\n\`\`\``,
      0,
      0,
      markdownTheme(theme, true),
    )
      .render(120)
      .join("\n");
    expect(rendered).toContain(highlightCode(code, language)[0]);
    expect(stripTerminalSequences(rendered)).toContain(code);
  });

  it("keeps unknown or unlabelled fences readable and recognizes annotated language tags", () => {
    initTheme("dark");
    const render = markdownTheme(theme, true).highlightCode;
    const code = "def f(): return 42";
    expect(render?.(code, "Python title=example.py")).toEqual(
      highlightCode(code, "python"),
    );
    expect(render?.(code, "unknown-example")).toEqual(highlightCode(code));
    expect(render?.(code)).toEqual(highlightCode(code));
    expect(markdownTheme(theme, false).highlightCode?.(code, "python")).toEqual(
      [code],
    );
  });
});
