import { type Color, foregroundAnsi, mixColors } from "@earendil-works/pi-tui";

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

interface WorkingTheme {
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

function sampleGradient(stops: readonly Color[], position: number): Color {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * stops.length;
  const index = Math.floor(scaled) % stops.length;
  const next = (index + 1) % stops.length;
  const from = stops[index] ?? stops[0];
  const to = stops[next] ?? stops[0];
  return mixColors(from, to, scaled - Math.floor(scaled));
}

export function crushWorkingIndicator(theme: WorkingTheme): {
  frames: string[];
  intervalMs: number;
} {
  const mode = theme.getColorMode();
  const stops = GRADIENT_TOKENS.map((token) => theme.colors[token]);
  const frames = Array.from({ length: FRAME_COUNT }, (_, frame) => {
    // Cosine breath from 0 to 1 and back over ~1.6s.
    const breath = (1 - Math.cos((frame / FRAME_COUNT) * Math.PI * 2)) / 2;
    const position = frame / FRAME_COUNT;
    let text = "";
    for (let column = 0; column < COLUMNS; column++) {
      const glyph = GLYPHS[(frame * 2 + column * 5) % GLYPHS.length];
      const gradient = sampleGradient(
        stops,
        position + (column / (COLUMNS - 1)) * 0.5,
      );
      const color = mixColors(
        theme.colors.muted,
        gradient,
        0.35 + 0.65 * breath,
      );
      text += `${foregroundAnsi(color, mode)}${glyph}`;
    }
    return `${text}${RESET_FG}`;
  });
  return { frames, intervalMs: 50 };
}
