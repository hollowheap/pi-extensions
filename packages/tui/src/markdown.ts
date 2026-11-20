import {
  type Theme,
  type ThemeColor,
  highlightCode,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type DefaultTextStyle,
  Markdown,
  type MarkdownOptions,
  type MarkdownTheme,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { normalizeAgentMarkdown } from "@hollowheap/core/markdown";
import { getActiveTuiConfig } from "./state.js";

export { normalizeAgentMarkdown } from "@hollowheap/core/markdown";

const LIST_BULLETS = ["●", "○", "◆", "◇"] as const;

type CalloutKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

interface CalloutStyle {
  readonly icon: string;
  readonly title: string;
  readonly color: ThemeColor;
}

const CALLOUT_STYLES: Record<CalloutKind, CalloutStyle> = {
  NOTE: { icon: "ℹ", title: "Note", color: "accent" },
  TIP: { icon: "✦", title: "Tip", color: "success" },
  IMPORTANT: { icon: "◆", title: "Important", color: "accent" },
  WARNING: { icon: "▲", title: "Warning", color: "warning" },
  CAUTION: { icon: "✖", title: "Caution", color: "error" },
};

const FENCE_LINE_RE = /^```(.*)$/;
const UNORDERED_LIST_RE = /^((?: {4})*)- ((?:\[[ xX]\] )?)(.*)$/;
const CALLOUT_HEADER_RE =
  /^▎\s+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+(.*))?$/i;

export function markdownTheme(
  theme: Theme,
  colored = getActiveTuiConfig().colored,
): MarkdownTheme {
  const fg = (token: ThemeColor, text: string) =>
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
    quoteBorder: (text) => fg("border", text.replace(/│/g, "▎")),
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

export interface RenderMarkdownOptions {
  colored?: boolean;
  paddingX?: number;
  paddingY?: number;
  defaultTextStyle?: DefaultTextStyle;
  markdownOptions?: MarkdownOptions;
}

function stripLeadingAnsiAndText(line: string, plainPrefix: string): string {
  let targetIndex = 0;
  let i = 0;
  while (i < line.length && targetIndex < plainPrefix.length) {
    if (line[i] === "\x1b" && line[i + 1] === "[") {
      const end = line.indexOf("m", i + 2);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    if (line[i] === plainPrefix[targetIndex]) {
      targetIndex++;
    }
    i++;
  }
  while (line[i] === "\x1b" && line[i + 1] === "[") {
    const end = line.indexOf("m", i + 2);
    if (end === -1) break;
    i = end + 1;
  }
  return line.slice(i);
}

function formatCodeFenceTop(
  lang: string,
  width: number,
  fg: (token: ThemeColor, text: string) => string,
): string {
  const safeWidth = Math.max(4, width);
  if (!lang) {
    return fg("border", `╭${"─".repeat(safeWidth - 1)}`);
  }
  const label = lang.trim();
  const prefix = "╭─ ";
  const suffix = " ";
  const used =
    visibleWidth(prefix) + visibleWidth(label) + visibleWidth(suffix);
  const fillCount = Math.max(1, safeWidth - used);
  return (
    fg("border", prefix) +
    fg("accent", label) +
    fg("border", `${suffix}${"─".repeat(fillCount)}`)
  );
}

function formatCodeFenceBottom(
  width: number,
  fg: (token: ThemeColor, text: string) => string,
): string {
  const safeWidth = Math.max(4, width);
  return fg("border", `╰${"─".repeat(safeWidth - 1)}`);
}

function styleRenderedLines(
  lines: string[],
  width: number,
  theme: Theme,
  colored: boolean,
): string[] {
  const fg = (token: ThemeColor, text: string) =>
    colored ? theme.fg(token, text) : text;
  const out: string[] = [];
  let inCodeBlock = false;
  let activeCallout: CalloutStyle | null = null;

  for (const rawLine of lines) {
    const stripped = stripTerminalSequences(rawLine).trimEnd();
    const fenceMatch = FENCE_LINE_RE.exec(stripped);

    if (fenceMatch) {
      activeCallout = null;
      if (!inCodeBlock) {
        inCodeBlock = true;
        out.push(formatCodeFenceTop(fenceMatch[1] ?? "", width, fg));
      } else {
        inCodeBlock = false;
        out.push(formatCodeFenceBottom(width, fg));
      }
      continue;
    }

    if (inCodeBlock) {
      const body = rawLine.startsWith("  ") ? rawLine.slice(2) : rawLine;
      out.push(`${fg("border", "│ ")}${body}`);
      continue;
    }

    const calloutMatch = CALLOUT_HEADER_RE.exec(stripped);
    if (calloutMatch) {
      const kind = (calloutMatch[1] ?? "NOTE").toUpperCase() as CalloutKind;
      const style = CALLOUT_STYLES[kind];
      const customTitle = calloutMatch[2]?.trim();
      const heading = customTitle
        ? `${style.icon} ${customTitle}`
        : `${style.icon} ${style.title}`;
      activeCallout = style;
      out.push(
        `${fg(style.color, "▎ ")}${fg(style.color, theme.bold(heading))}`,
      );
      continue;
    }

    if (activeCallout) {
      if (stripped.startsWith("▎")) {
        const rest = stripLeadingAnsiAndText(rawLine, "▎ ");
        out.push(`${fg(activeCallout.color, "▎ ")}${rest}`);
        continue;
      }
      activeCallout = null;
    }

    const listMatch = UNORDERED_LIST_RE.exec(stripped);
    if (listMatch) {
      const indentSpaces = listMatch[1] ?? "";
      const taskMarker = listMatch[2] ?? "";
      const depth = indentSpaces.length / 4;
      const glyph = LIST_BULLETS[depth % LIST_BULLETS.length] ?? "●";
      const plainPrefix = `${indentSpaces}- ${taskMarker}`;
      const rest = stripLeadingAnsiAndText(rawLine, plainPrefix);
      const renderedIndent = "  ".repeat(depth);
      const renderedBullet = fg("accent", `${glyph} ${taskMarker}`);
      out.push(`${renderedIndent}${renderedBullet}${rest}`);
      continue;
    }

    out.push(rawLine);
  }

  return out;
}

export function renderMarkdown(
  markdown: string,
  width: number,
  theme: Theme,
  options: RenderMarkdownOptions = {},
): string[] {
  const colored = options.colored ?? getActiveTuiConfig().colored;
  const paddingX = options.paddingX ?? 0;
  const paddingY = options.paddingY ?? 0;
  const normalized = normalizeAgentMarkdown(markdown);
  const rawLines = new Markdown(
    normalized,
    paddingX,
    paddingY,
    markdownTheme(theme, colored),
    options.defaultTextStyle,
    options.markdownOptions,
  ).render(width);
  const contentWidth = Math.max(1, width - paddingX * 2);
  return styleRenderedLines(rawLines, contentWidth, theme, colored);
}

export class StyledMarkdown implements Component {
  private text: string;
  private readonly theme: Theme;
  private readonly options: RenderMarkdownOptions;
  private cachedWidth?: number;
  private cachedText?: string;
  private cachedLines?: string[];

  constructor(text: string, theme: Theme, options: RenderMarkdownOptions = {}) {
    this.text = text;
    this.theme = theme;
    this.options = options;
  }

  setText(text: string): void {
    this.text = text;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedText = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (
      this.cachedLines &&
      this.cachedText === this.text &&
      this.cachedWidth === width
    ) {
      return this.cachedLines;
    }
    const lines = renderMarkdown(this.text, width, this.theme, this.options);
    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }
}
