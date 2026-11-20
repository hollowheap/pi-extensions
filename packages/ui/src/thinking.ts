import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type DefaultTextStyle,
  Markdown,
  type MarkdownOptions,
  MouseRegion,
  foregroundAnsi,
  mixColors,
  rgbColor,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import type { ShimmerSpeed, TuiConfig } from "@hollowheap/core/tui-config";
import { renderMarkdown } from "./markdown.js";
import { isWorkingTheme } from "./spinner.js";
import { getActiveTuiConfig } from "./state.js";

const RESET_FG = "\x1b[39m";
const DEFAULT_SHIMMER_BAND = 10;
/** Base shimmer frame interval; the sweep accelerates with line length. */
export const SHIMMER_BASE_INTERVAL_MS = 45;
export const SHIMMER_SPEED_INTERVALS_MS: Readonly<
  Record<ShimmerSpeed, number>
> = {
  slow: 80,
  normal: SHIMMER_BASE_INTERVAL_MS,
  fast: 24,
};

export function getShimmerIntervalMs(speed: ShimmerSpeed = "normal"): number {
  return SHIMMER_SPEED_INTERVALS_MS[speed] ?? SHIMMER_BASE_INTERVAL_MS;
}
const SHIMMER_ACCELERATION_CHARS = 60;
const MAX_SHIMMER_SPEED = 6;

/** Sweep speed multiplier: longer lines cycle the highlight faster. */
export function shimmerSpeed(textLength: number): number {
  return Math.min(
    MAX_SHIMMER_SPEED,
    1 + Math.max(0, textLength) / SHIMMER_ACCELERATION_CHARS,
  );
}

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

const THINKING_PREFIXES = {
  standard: "Thinking: ",
  terse: "think: ",
  playful: "Pondering: ",
} as const;

export function formatThinkingMarkdown(
  markdown: string,
  width: number,
  config: Pick<TuiConfig, "thinkingVerbosity" | "verbPack">,
): string {
  if (config.thinkingVerbosity === "none") return "";
  if (
    config.thinkingVerbosity !== "medium" &&
    config.thinkingVerbosity !== "minimal"
  ) {
    return markdown;
  }
  return formatOneLineThinkingText(markdown, width, {
    pick: "first",
    prefix: THINKING_PREFIXES[config.verbPack],
  });
}

const MARKDOWN_INLINE_RE = /[\\`*_~<>[\]]/g;

/** Escape inline Markdown punctuation for literal plain-text fields such as titles. */
export function escapeMarkdownInline(text: string): string {
  return text.replace(MARKDOWN_INLINE_RE, (ch) => `\\${ch}`);
}

const MARKDOWN_STRIP_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/`([^`\n]*)`/g, "$1"],
  [/!\[([^\]]*)\]\([^)]*\)/g, "$1"],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  [/\*\*([^*]+)\*\*/g, "$1"],
  [/__([^_]+)__/g, "$1"],
  [/~~([^~]+)~~/g, "$1"],
  [/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1"],
  [/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "$1"],
];

/** Remove inline Markdown syntax for plain-text labels and color spans. */
export function stripMarkdownInline(text: string): string {
  let out = text;
  for (const [pattern, replacement] of MARKDOWN_STRIP_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** @deprecated Shimmer no longer escapes Markdown; retained for source compatibility. */
export interface ShimmerOptions {
  escapeMarkdown?: boolean;
}

/** Render a horizontal scrolling color highlight sweep (`agy`-style) across `text`. */
export function renderThinkingShimmerFrame(
  text: string,
  step: number,
  theme?: unknown,
  colored = true,
  _options?: ShimmerOptions,
): string {
  if (!colored || text.length === 0) {
    return text;
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
  const speed = shimmerSpeed(chars.length);
  const center =
    (((Math.floor(step * speed) % span) + span) % span) - DEFAULT_SHIMMER_BAND;

  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    const token = ch;
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

/** Minimal redraw surface the shimmer animator needs from a TUI host. */
export interface ThinkingShimmerRedrawTarget {
  requestRender?: (force?: boolean) => void;
}

export interface ThinkingShimmerAnimator {
  readonly step: number;
  frame(text: string, theme?: unknown, colored?: boolean): string;
  dispose(): void;
}

/**
 * Own shimmer step advancement and redraw scheduling while streaming. The
 * host may not repaint message text on its own cadence, so the animator drives
 * repaints itself instead of relying on incidental re-renders.
 */
export function createThinkingShimmerAnimator(
  target: ThinkingShimmerRedrawTarget | undefined,
  options?: { intervalMs?: number; speed?: ShimmerSpeed },
): ThinkingShimmerAnimator {
  const intervalMs = Math.max(
    1,
    options?.intervalMs ?? getShimmerIntervalMs(options?.speed),
  );
  let step = 0;
  let disposed = false;
  const timer = setInterval(() => {
    if (disposed) return;
    step += 1;
    target?.requestRender?.();
  }, intervalMs);
  timer.unref?.();
  return {
    get step() {
      return step;
    },
    frame(text, theme, colored = true) {
      return renderThinkingShimmerFrame(text, step, theme, colored);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
    },
  };
}

type MarkdownTransformer = Parameters<
  ExtensionAPI["registerMarkdownTransformer"]
>[0];
const THINKING_VISIBILITY = Symbol.for("@hollowheap/ui/thinking-visibility");
const STYLED_THINKING_MARKDOWN = Symbol.for(
  "@hollowheap/ui/styled-thinking-markdown",
);

function styleThinkingMarkdownChild(
  child: Markdown,
  getTheme: () => Theme | undefined,
): void {
  if (Reflect.get(child, STYLED_THINKING_MARKDOWN) === true) return;
  Reflect.set(child, STYLED_THINKING_MARKDOWN, true);
  const originalRender = child.render.bind(child);
  child.render = (width: number): string[] => {
    const cfg = getActiveTuiConfig();
    const theme = getTheme();
    const isOneLine =
      cfg.thinkingVerbosity === "medium" || cfg.thinkingVerbosity === "minimal";
    if (!cfg.markdownRender || isOneLine || !theme) {
      return originalRender(width);
    }
    const rawText = Reflect.get(child, "text");
    if (typeof rawText !== "string") {
      return originalRender(width);
    }
    const paddingX = Reflect.get(child, "paddingX");
    const paddingY = Reflect.get(child, "paddingY");
    const defaultTextStyle = Reflect.get(child, "defaultTextStyle") as
      | DefaultTextStyle
      | undefined;
    const markdownOptions = Reflect.get(child, "markdownOptions") as
      | MarkdownOptions
      | undefined;
    const safePaddingX = typeof paddingX === "number" ? paddingX : 0;
    const safePaddingY = typeof paddingY === "number" ? paddingY : 0;
    const contentWidth = Math.max(1, width - safePaddingX * 2);
    const transformed =
      typeof markdownOptions?.transform === "function"
        ? markdownOptions.transform(rawText, contentWidth)
        : rawText;
    if (transformed === "") return [];
    return renderMarkdown(transformed, width, theme, {
      colored: cfg.colored,
      paddingX: safePaddingX,
      paddingY: safePaddingY,
      defaultTextStyle,
    });
  };
}

/** Apply our display preference before Pi chooses its native thinking component. */
export function installThinkingVisibility(
  transformer: MarkdownTransformer,
  getTheme?: () => Theme | undefined,
): void {
  const prototype = AssistantMessageComponent.prototype;
  const registered = Reflect.get(prototype, THINKING_VISIBILITY) as
    | {
        transformers: WeakSet<MarkdownTransformer>;
        getTheme: () => Theme | undefined;
      }
    | undefined;
  if (registered) {
    registered.transformers.add(transformer);
    if (getTheme) registered.getTheme = getTheme;
    return;
  }

  const state = {
    transformers: new WeakSet([transformer]),
    getTheme: getTheme ?? (() => undefined),
  };
  Reflect.defineProperty(prototype, THINKING_VISIBILITY, {
    value: state,
  });
  const updateContent = prototype.updateContent;
  prototype.updateContent = function (message, streaming) {
    const activeTransformers: unknown = Reflect.get(
      this,
      "markdownTransformers",
    );
    const hostHidden: unknown = Reflect.get(this, "hideThinkingBlock");
    const overrides: unknown = Reflect.get(this, "thinkingVisibilityOverrides");
    if (
      typeof hostHidden !== "boolean" ||
      !Array.isArray(activeTransformers) ||
      !activeTransformers.some((fn) => state.transformers.has(fn)) ||
      !(overrides instanceof Map)
    ) {
      updateContent.call(this, message, streaming);
      return;
    }

    // Pi selects its hidden Text or expanded Markdown branch before calling
    // transformers. Apply the preference for this render without writing settings.
    Reflect.set(
      this,
      "hideThinkingBlock",
      getActiveTuiConfig().thinkingVerbosity === "low",
    );
    overrides.clear();
    try {
      updateContent.call(this, message, streaming);
    } finally {
      Reflect.set(this, "hideThinkingBlock", hostHidden);
    }

    const contentContainer = Reflect.get(this, "contentContainer") as
      | { children?: unknown[] }
      | undefined;
    if (!Array.isArray(contentContainer?.children)) return;
    for (const child of contentContainer.children) {
      if (!(child instanceof MouseRegion)) continue;
      const inner = Reflect.get(child, "child");
      if (!(inner instanceof Markdown)) continue;
      const style = Reflect.get(inner, "defaultTextStyle") as
        | DefaultTextStyle
        | undefined;
      if (style?.italic === true) {
        styleThinkingMarkdownChild(inner, () => state.getTheme());
      }
    }
  };
}
