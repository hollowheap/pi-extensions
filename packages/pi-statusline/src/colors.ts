import { type Color, indexedColor, parseColor } from "@earendil-works/pi-tui";

const NAMED_COLORS: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  purple: 5,
  magenta: 5,
  cyan: 6,
  white: 7,
  "bright-black": 8,
  "bright-red": 9,
  "bright-green": 10,
  "bright-yellow": 11,
  "bright-blue": 12,
  "bright-purple": 13,
  "bright-magenta": 13,
  "bright-cyan": 14,
  "bright-white": 15,
};

export function parseColorSpec(value: string | number): Color | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 255
      ? indexedColor(value)
      : undefined;
  }
  const named = NAMED_COLORS[value.toLowerCase()];
  if (named !== undefined) return indexedColor(named);
  if (/^\d{1,3}$/.test(value)) {
    const index = Number(value);
    return index <= 255 ? indexedColor(index) : undefined;
  }
  try {
    return parseColor(value);
  } catch {
    return undefined;
  }
}
