import {
  foregroundAnsi,
  mixColors,
  rgbColor,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { isWorkingTheme } from "./spinner.js";

const RESET_FG = "\x1b[39m";
const DEFAULT_SHIMMER_BAND = 10;

export interface FormatThinkingOptions {
  /** Select `"latest"` while streaming so the preview tracks current thoughts, or `"first"` when settled. */
  pick?: "latest" | "first";
  prefix?: string;
}

/** Collapse multi-line thinking text into one clean single-line summary fitted to `maxWidth`. */
export function formatOneLineThinkingText(
  raw: string,
  maxWidth: number,
  options?: FormatThinkingOptions,
): string {
  const safeWidth = Math.max(4, Math.floor(maxWidth));
  const prefix = options?.prefix ?? "Thinking: ";
  const cleanLines = sanitizeTerminalText(raw)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

  const selected =
    cleanLines.length === 0
      ? "…"
      : options?.pick === "first"
        ? (cleanLines[0] ?? "…")
        : (cleanLines[cleanLines.length - 1] ?? "…");

  const combined =
    selected === "…" ? `${prefix.trimEnd()} …` : `${prefix}${selected}`;
  return truncateToWidth(combined, safeWidth, "…");
}

const MARKDOWN_INLINE_RE = /[\\`*_~<>[\]]/g;

/** Escape inline Markdown punctuation so plain text survives Markdown rendering literally. */
export function escapeMarkdownInline(text: string): string {
  return text.replace(MARKDOWN_INLINE_RE, (ch) => `\\${ch}`);
}

export interface ShimmerOptions {
  /** Escape Markdown inline punctuation inside each color span (used before `Markdown` lexing). */
  escapeMarkdown?: boolean;
}

/** Render a horizontal scrolling color highlight sweep (`agy`-style) across `text`. */
export function renderThinkingShimmerFrame(
  text: string,
  step: number,
  theme?: unknown,
  colored = true,
  options?: ShimmerOptions,
): string {
  const escapeMd = options?.escapeMarkdown ?? false;
  if (!colored || text.length === 0) {
    return escapeMd ? escapeMarkdownInline(text) : text;
  }
  const chars = Array.from(text);
  const workingTheme = isWorkingTheme(theme) ? theme : undefined;
  const mode = workingTheme?.getColorMode() ?? "truecolor";
  const baseColor =
    workingTheme?.colors.thinkingText ?? rgbColor(150, 140, 190);
  const highlightColor = workingTheme?.colors.accent ?? rgbColor(235, 245, 255);
  const secondaryColor =
    workingTheme?.colors.borderAccent ?? rgbColor(140, 220, 255);

  const span = chars.length + DEFAULT_SHIMMER_BAND * 2;
  const center =
    (((Math.floor(step) % span) + span) % span) - DEFAULT_SHIMMER_BAND;

  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    const token = escapeMd ? escapeMarkdownInline(ch) : ch;
    const distance = Math.abs(i - center);
    if (distance >= DEFAULT_SHIMMER_BAND) {
      out += `${foregroundAnsi(baseColor, mode)}${token}`;
      continue;
    }
    const weight =
      (1 + Math.cos((distance / DEFAULT_SHIMMER_BAND) * Math.PI)) / 2;
    const peak =
      distance < 3
        ? highlightColor
        : mixColors(highlightColor, secondaryColor, (distance - 3) / 7);
    const color = mixColors(baseColor, peak, weight);
    out += `${foregroundAnsi(color, mode)}${token}`;
  }
  return `${out}${RESET_FG}`;
}
