import type {
  Theme,
  ThemeBg,
  ThemeColor,
  ThemeStyle,
} from "@earendil-works/pi-coding-agent";
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

export interface TextStyle {
  fg?: ThemeColor | Color;
  bg?: ThemeBg | Color;
  bold?: boolean;
}

export interface ComponentStyle extends TextStyle {
  accent?: ThemeColor | Color;
  icon?: string;
  iconSide?: "left" | "right";
  iconFg?: ThemeColor | Color;
  iconBg?: ThemeBg | Color;
  leftCap?: string;
  rightCap?: string;
}

export function styleText(
  text: string,
  style: TextStyle,
  theme: Theme,
): string {
  if (
    style.fg === undefined &&
    style.bg === undefined &&
    style.bold === undefined
  ) {
    return text;
  }
  const options: ThemeStyle = {};
  if (style.fg !== undefined) options.fg = style.fg;
  if (style.bg !== undefined) options.bg = style.bg;
  if (style.bold !== undefined) options.bold = style.bold;
  try {
    return theme.style(text, options);
  } catch {
    return text;
  }
}

function toBg(
  color: ThemeColor | ThemeBg | Color | undefined,
  theme: Theme,
): ThemeBg | Color | undefined {
  if (color === undefined) return undefined;
  if (typeof color === "object") return color;
  const tokenColor = theme.colors?.[color as ThemeColor];
  if (tokenColor !== undefined) return tokenColor;
  return color as ThemeBg;
}

function toFg(
  color: ThemeColor | ThemeBg | Color | undefined,
  theme: Theme,
): ThemeColor | Color | undefined {
  if (color === undefined) return undefined;
  if (typeof color === "object") return color;
  const tokenColor = theme.colors?.[color as ThemeColor];
  if (tokenColor !== undefined) return tokenColor;
  return color as ThemeColor;
}

export function styleComponent(
  text: string,
  style: ComponentStyle,
  theme: Theme,
): string {
  if (text === "") return "";
  if (style.accent === undefined) {
    return styleText(text, style, theme);
  }
  const accent = style.accent;
  const iconOnRight = style.iconSide === "right";
  const leftCapChar = style.leftCap ?? "";
  const rightCapChar = style.rightCap ?? "";
  const defaultBodyBg =
    style.icon !== undefined ? parseColorSpec("bright-white") : accent;
  const bodyBg = style.bg ?? defaultBodyBg;
  const bodyFg = style.fg ?? parseColorSpec("black");
  const iconFg = style.iconFg ?? parseColorSpec("black");
  const iconBg = style.iconBg ?? accent;

  const capFg = iconOnRight ? bodyBg : accent;
  const leftCap = styleText(leftCapChar, { fg: toFg(capFg, theme) }, theme);
  const iconPart =
    style.icon !== undefined && style.icon !== ""
      ? styleText(
          iconOnRight ? ` ${style.icon}` : `${style.icon} `,
          {
            fg: toFg(iconFg, theme),
            bg: toBg(iconBg, theme),
            bold: style.bold,
          },
          theme,
        )
      : "";
  const bodyPart = styleText(
    ` ${text} `,
    { fg: toFg(bodyFg, theme), bg: toBg(bodyBg, theme), bold: style.bold },
    theme,
  );
  const rightCap = styleText(
    rightCapChar,
    { fg: toFg(iconOnRight ? accent : bodyBg, theme) },
    theme,
  );
  return iconOnRight
    ? `${leftCap}${bodyPart}${iconPart}${rightCap}`
    : `${leftCap}${iconPart}${bodyPart}${rightCap}`;
}
