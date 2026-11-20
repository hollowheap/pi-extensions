import { type Color, foregroundAnsi, mixColors } from "@earendil-works/pi-tui";
import type {
  LoadingIndicatorColor,
  LoadingIndicatorStyle,
} from "@hollowheap/core/tui-config";

const GLYPHS = "0123456789abcdef~!@#$%^&*";
const COLUMNS = 8;
const FRAME_COUNT = 32;
const RESET_FG = "\x1b[39m";

const GRADIENT_TOKENS = [
  "error",
  "warning",
  "success",
  "borderAccent",
  "accent",
  "thinkingText",
  "text",
] as const;

const REQUIRED_WORKING_COLOR_TOKENS = [
  "error",
  "warning",
  "success",
  "borderAccent",
  "accent",
  "thinkingText",
  "text",
  "muted",
] as const;

export interface WorkingTheme {
  readonly colors: {
    readonly accent: Color;
    readonly borderAccent: Color;
    readonly success: Color;
    readonly warning: Color;
    readonly error: Color;
    readonly thinkingText: Color;
    readonly text: Color;
    readonly muted: Color;
  };
  getColorMode(): "256color" | "truecolor";
}

export interface WorkingIndicatorFrames {
  frames: string[];
  intervalMs: number;
}

export interface WorkingIndicatorOptions {
  color?: LoadingIndicatorColor;
  fade?: boolean;
}

/** Check whether an object provides the color tokens required by dynamic gradient indicators. */
export function isWorkingTheme(theme: unknown): theme is WorkingTheme {
  if (typeof theme !== "object" || theme === null) return false;
  const candidate = theme as Partial<WorkingTheme>;
  if (
    typeof candidate.getColorMode !== "function" ||
    typeof candidate.colors !== "object" ||
    candidate.colors === null
  ) {
    return false;
  }
  const colors = candidate.colors as unknown as Record<string, unknown>;
  return REQUIRED_WORKING_COLOR_TOKENS.every(
    (token) => colors[token] !== undefined && colors[token] !== null,
  );
}

function sampleGradient(stops: readonly Color[], position: number): Color {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * stops.length;
  const index = Math.floor(scaled) % stops.length;
  const next = (index + 1) % stops.length;
  const from = stops[index] ?? stops[0];
  const to = stops[next] ?? stops[0];
  return mixColors(from, to, scaled - Math.floor(scaled));
}

function resolveIndicatorColor(
  theme: WorkingTheme,
  stops: readonly Color[],
  position: number,
  colorMode: LoadingIndicatorColor,
): Color {
  if (colorMode === "gradient") {
    return sampleGradient(stops, position);
  }
  return theme.colors[colorMode] ?? theme.colors.accent;
}

export function crushWorkingIndicator(
  theme: WorkingTheme,
  colored = true,
  options?: WorkingIndicatorOptions,
): WorkingIndicatorFrames {
  const mode = theme.getColorMode();
  const colorMode = options?.color ?? "gradient";
  const fade = options?.fade ?? true;
  const stops = GRADIENT_TOKENS.map((token) => theme.colors[token]);
  const frames = Array.from({ length: FRAME_COUNT }, (_, frame) => {
    // Cosine breath from 0 to 1 and back over ~1.6s.
    const breath = (1 - Math.cos((frame / FRAME_COUNT) * Math.PI * 2)) / 2;
    const position = frame / FRAME_COUNT;
    let text = "";
    for (let column = 0; column < COLUMNS; column++) {
      const glyph = GLYPHS[(frame * 2 + column * 5) % GLYPHS.length];
      if (!colored) {
        text += glyph;
        continue;
      }
      const target = resolveIndicatorColor(
        theme,
        stops,
        position + (column / (COLUMNS - 1)) * 0.5,
        colorMode,
      );
      const color = fade
        ? mixColors(theme.colors.muted, target, 0.35 + 0.65 * breath)
        : target;
      text += `${foregroundAnsi(color, mode)}${glyph}`;
    }
    return colored ? `${text}${RESET_FG}` : text;
  });
  return { frames, intervalMs: 50 };
}

function tintSimpleFrames(
  glyphs: readonly string[],
  intervalMs: number,
  theme: unknown,
  colored: boolean,
  options?: WorkingIndicatorOptions,
): WorkingIndicatorFrames {
  if (!colored || !isWorkingTheme(theme)) {
    return { frames: [...glyphs], intervalMs };
  }
  const mode = theme.getColorMode();
  const colorMode = options?.color ?? "gradient";
  const fade = options?.fade ?? true;
  const stops = [
    theme.colors.accent,
    theme.colors.borderAccent,
    theme.colors.thinkingText,
  ] as const;
  const frames = glyphs.map((frame, index) => {
    const position = index / Math.max(1, glyphs.length);
    const target = resolveIndicatorColor(theme, stops, position, colorMode);
    const breath = (1 - Math.cos(position * Math.PI * 2)) / 2;
    const color = fade
      ? mixColors(theme.colors.muted, target, 0.25 + 0.75 * breath)
      : target;
    return `${foregroundAnsi(color, mode)}${frame}${RESET_FG}`;
  });
  return { frames, intervalMs };
}

type FixedSpinner = Exclude<LoadingIndicatorStyle, "host" | "crush">;
export const SPINNER_PRESETS = {
  hidden: [[], 1000],
  claude: [["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"], 100],
  braille: [["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 80],
  pulse: [["∙", "•", "●", "◉", "●", "•"], 120],
  arc: [["◜", "◠", "◝", "◞", "◡", "◟"], 100],
  bars: [
    [
      "▁▂▃▄",
      "▂▃▄▅",
      "▃▄▅▆",
      "▄▅▆▇",
      "▅▆▇█",
      "▆▇█▇",
      "▇█▇▆",
      "█▇▆▅",
      "▇▆▅▄",
      "▆▅▄▃",
      "▅▄▃▂",
      "▄▃▂▁",
      "▃▂▁▂",
      "▂▁▂▃",
    ],
    80,
  ],
  dots: [["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"], 80],
} as const satisfies Record<FixedSpinner, readonly [readonly string[], number]>;

/** Build working indicator frames for a configured style, or `undefined` for the host default. */
export function createWorkingIndicator(
  style: LoadingIndicatorStyle,
  theme?: unknown,
  colored = true,
  options?: WorkingIndicatorOptions,
): WorkingIndicatorFrames | undefined {
  if (style === "host") return undefined;

  if (Object.hasOwn(SPINNER_PRESETS, style)) {
    const [frames, intervalMs] = SPINNER_PRESETS[style as FixedSpinner];
    return tintSimpleFrames(frames, intervalMs, theme, colored, options);
  }

  if (isWorkingTheme(theme)) {
    return crushWorkingIndicator(theme, colored, options);
  }
  const [frames, intervalMs] = SPINNER_PRESETS.braille;
  return tintSimpleFrames(frames, intervalMs, theme, colored, options);
}
