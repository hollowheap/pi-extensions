import { type Theme, highlightCode } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { getActiveTuiConfig } from "./state.js";

export { normalizeAgentMarkdown } from "@hollowheap/core/markdown";

export function markdownTheme(
  theme: Theme,
  colored = getActiveTuiConfig().colored,
): MarkdownTheme {
  const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
    colored ? theme.fg(token, text) : text;
  const codeBlock = (text: string) => fg("toolOutput", text);
  return {
    heading: (text) => fg("accent", theme.bold(text)),
    link: (text) => fg("accent", text),
    linkUrl: (text) => fg("dim", text),
    code: (text) => fg("toolOutput", text),
    codeBlock,
    codeBlockBorder: (text) => fg("border", text),
    quote: (text) => fg("muted", text),
    quoteBorder: (text) => fg("border", text),
    hr: (text) => fg("border", text),
    listBullet: (text) => fg("accent", text),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
    strikethrough: (text) => theme.strikethrough(text),
    underline: (text) => theme.underline(text),
    highlightCode: (code, lang) =>
      colored
        ? highlightCode(code, lang?.trim().split(/\s+/, 1)[0]?.toLowerCase())
        : code.split("\n"),
  };
}
