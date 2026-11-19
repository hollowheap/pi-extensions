import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { normalizeAgentMarkdown } from "@hollowheap/core/markdown";
import { describe, expect, it } from "vitest";

const plainMarkdownTheme = {
  heading: (t: string) => `[H:${t}]`,
  link: (t: string) => t,
  linkUrl: (t: string) => t,
  code: (t: string) => t,
  codeBlock: (t: string) => t,
  codeBlockBorder: (t: string) => t,
  quote: (t: string) => t,
  quoteBorder: (t: string) => t,
  hr: (t: string) => `[HR:${t}]`,
  listBullet: (t: string) => t,
  bold: (t: string) => t,
  italic: (t: string) => t,
  strikethrough: (t: string) => t,
  underline: (t: string) => t,
};

describe("normalizeAgentMarkdown", () => {
  it("normalizes standalone === and unspaced --- / === into rendered Markdown horizontal rules", () => {
    const input = [
      "Intro paragraph",
      "---",
      "",
      "====",
      "",
      "Section",
      "===",
    ].join("\n");
    const normalized = normalizeAgentMarkdown(input);
    expect(normalized).toBe(
      ["Intro paragraph", "", "---", "", "---", "", "Section", "", "---"].join(
        "\n",
      ),
    );

    const rendered = new Markdown(normalized, 0, 0, plainMarkdownTheme)
      .render(24)
      .map(stripTerminalSequences)
      .join("\n");
    expect(rendered).toContain("[HR:");
    expect(rendered).not.toContain("[H:Intro paragraph]");
    expect(rendered).not.toContain("====");
  });

  it("returns input unchanged when no dividers present", () => {
    const input = "Hello world\nNo dividers here";
    expect(normalizeAgentMarkdown(input)).toBe(input);
  });

  it("handles unclosed fence without crashing", () => {
    const input = "```\n---\n===\n";
    expect(() => normalizeAgentMarkdown(input)).not.toThrow();
  });

  it("preserves --- and === inside fenced code blocks and GFM tables", () => {
    const input = [
      "```markdown",
      "Heading",
      "---",
      "====",
      "```",
      "",
      "~~~txt",
      "===",
      "~~~",
      "",
      "| Col A | Col B |",
      "| --- | === |",
    ].join("\n");

    expect(normalizeAgentMarkdown(input)).toBe(input);
  });
});
