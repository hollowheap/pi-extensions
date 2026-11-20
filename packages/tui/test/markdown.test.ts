import { highlightCode, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  StyledMarkdown,
  markdownTheme,
  renderMarkdown,
} from "../src/markdown.js";

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

describe("render-markdown.nvim style rendering", () => {
  const tokenAnsi: Record<string, string> = {
    accent: "\x1b[34m",
    success: "\x1b[32m",
    warning: "\x1b[33m",
    error: "\x1b[31m",
    border: "\x1b[90m",
    muted: "\x1b[37m",
    dim: "\x1b[2m",
    toolOutput: "\x1b[36m",
  };
  const ansiTheme = {
    fg: (token: string, text: string) =>
      `${tokenAnsi[token] ?? "\x1b[39m"}${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
    italic: passthrough,
    underline: passthrough,
    strikethrough: passthrough,
  } as never;

  it("renders nested unordered lists with distinct bullet glyphs and clean indentation", () => {
    const md = [
      "- Level 0",
      "  - Level 1",
      "    - Level 2",
      "      - Level 3",
      "        - Level 4",
    ].join("\n");

    const lines = renderMarkdown(md, 80, theme, { colored: false }).map((l) =>
      stripTerminalSequences(l).trimEnd(),
    );

    expect(lines).toContain("● Level 0");
    expect(lines).toContain("  ○ Level 1");
    expect(lines).toContain("    ◆ Level 2");
    expect(lines).toContain("      ◇ Level 3");
    expect(lines).toContain("        ● Level 4");
  });

  it("frames fenced code blocks with language label header and preserves syntax highlighting", () => {
    initTheme("dark");
    const code = "const x: number = 1;";
    const lines = renderMarkdown(`\`\`\`ts\n${code}\n\`\`\``, 60, theme, {
      colored: true,
    });
    const plain = lines.map((l) => stripTerminalSequences(l).trimEnd());

    expect(plain[0]).toMatch(/^╭─ ts ─+$/);
    expect(plain[1]).toContain("│ ");
    expect(plain[1]).toContain(code);
    expect(lines[1]).toContain(highlightCode(code, "ts")[0]);
    expect(plain[2]).toMatch(/^╰─+$/);

    const unlabelled = renderMarkdown("```\nplain text\n```", 40, theme, {
      colored: false,
    }).map((l) => stripTerminalSequences(l).trimEnd());
    expect(unlabelled[0]).toMatch(/^╭─+$/);
    expect(unlabelled[1]).toBe("│ plain text");
    expect(unlabelled[2]).toMatch(/^╰─+$/);
  });

  it("renders blockquotes with ▎ left accent bar across nested depths", () => {
    const md = [
      "> Outer quote",
      ">",
      "> > Nested quote",
      "> >",
      "> > > Deep quote",
    ].join("\n");

    const lines = renderMarkdown(md, 80, theme, { colored: false }).map((l) =>
      stripTerminalSequences(l).trimEnd(),
    );

    expect(lines).toContain("▎ Outer quote");
    expect(lines).toContain("▎ ▎ Nested quote");
    expect(lines).toContain("▎ ▎ ▎ Deep quote");
  });

  it.each([
    ["NOTE", "ℹ", "Note", "accent"],
    ["TIP", "✦", "Tip", "success"],
    ["IMPORTANT", "◆", "Important", "accent"],
    ["WARNING", "▲", "Warning", "warning"],
    ["CAUTION", "✖", "Caution", "error"],
  ] as const)(
    "renders %s callout with semantic icon, title, and %s color",
    (kind, icon, title, color) => {
      const md = `> [!${kind}]\n> Callout body text`;
      const styled = renderMarkdown(md, 80, ansiTheme, { colored: true });
      const plain = styled.map((l) => stripTerminalSequences(l).trimEnd());
      const colorCode = tokenAnsi[color];

      expect(plain[0]).toBe(`▎ ${icon} ${title}`);
      expect(plain[1]).toBe("▎ Callout body text");
      expect(styled[0]).toContain(`${colorCode}▎ \x1b[0m`);
      expect(styled[0]).toContain(
        `${colorCode}\x1b[1m${icon} ${title}\x1b[0m\x1b[0m`,
      );
      expect(styled[1]).toContain(`${colorCode}▎ \x1b[0m`);
    },
  );

  it("supports StyledMarkdown component caching and updates", () => {
    const component = new StyledMarkdown("- First", theme, { colored: false });
    const first = component.render(40);
    expect(component.render(40)).toBe(first);
    expect(stripTerminalSequences(first.join("\n")).trim()).toBe("● First");

    component.setText("> [!TIP]\n> Updated");
    const second = component.render(40);
    expect(second).not.toBe(first);
    expect(stripTerminalSequences(second[0] ?? "").trim()).toBe("▎ ✦ Tip");
  });
});
