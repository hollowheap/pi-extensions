import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type BorderStyle, getBorderChars } from "@hollowheap/core/border";
import type { OverlaySurfaceMode } from "@hollowheap/core/tui-config";
import { getActiveTuiConfig, getHostOutputPadding } from "./state.js";
import { paintSurfaceLine } from "./surface.js";

export interface FrameOptions {
  borderStyle?: BorderStyle;
  overlaySurface?: OverlaySurfaceMode;
  colored?: boolean;
  paddingX?: 0 | 1;
}

function framePadding(
  width: number,
  borderStyle: BorderStyle,
  paddingX?: 0 | 1,
): 0 | 1 {
  if (borderStyle !== "none" && width < 5) return 0;
  return paddingX ?? getHostOutputPadding() ?? (borderStyle === "none" ? 0 : 1);
}

/** Return usable content width inside the selected border and padding. */
export function getFrameInnerWidth(
  width: number,
  borderStyle: BorderStyle = getActiveTuiConfig().borderStyle,
  paddingX?: 0 | 1,
): number {
  const edges = borderStyle === "none" ? 0 : 2;
  return Math.max(
    1,
    Math.max(4, width) - edges - 2 * framePadding(width, borderStyle, paddingX),
  );
}

/** Draw a configurable box around already-rendered lines. */
export function boxFrame(
  lines: readonly string[],
  width: number,
  theme: Theme,
  title?: string,
  options?: FrameOptions,
): string[] {
  const safeWidth = Math.max(4, width);
  const active = getActiveTuiConfig();
  const borderStyle = options?.borderStyle ?? active.borderStyle;
  const overlaySurface = options?.overlaySurface ?? active.overlaySurface;
  const colored = options?.colored ?? active.colored;
  const paddingX = framePadding(safeWidth, borderStyle, options?.paddingX);
  const innerWidth = getFrameInnerWidth(safeWidth, borderStyle, paddingX);
  const inset = " ".repeat(paddingX);

  const border = (value: string) =>
    colored && typeof theme?.fg === "function"
      ? theme.fg("border", value)
      : value;
  const fg = (token: string, value: string) =>
    colored && typeof theme?.fg === "function"
      ? theme.fg(token as never, value)
      : value;
  const bold = (value: string) =>
    typeof theme?.bold === "function" ? theme.bold(value) : value;

  if (borderStyle === "none") {
    const rows: string[] = [];
    if (title) {
      const titleLine = truncateToWidth(
        fg("accent", bold(title)),
        innerWidth,
        "",
      );
      rows.push(
        paintSurfaceLine(
          inset + titleLine,
          safeWidth,
          theme,
          overlaySurface,
          colored,
        ),
      );
    }
    for (const line of lines) {
      const fitted = inset + truncateToWidth(line, innerWidth, "");
      rows.push(
        paintSurfaceLine(fitted, safeWidth, theme, overlaySurface, colored),
      );
    }
    return rows;
  }

  const chars = getBorderChars(borderStyle);
  const rawLabel = title ? ` ${fg("accent", bold(title))} ` : "";
  const label = truncateToWidth(rawLabel, Math.max(0, safeWidth - 3), "");
  const labelWidth = visibleWidth(label);
  const topFill = Math.max(0, safeWidth - 3 - labelWidth);
  const top =
    border(`${chars.topLeft}${chars.horizontal}`) +
    label +
    border(`${chars.horizontal.repeat(topFill)}${chars.topRight}`);
  const bottom = border(
    `${chars.bottomLeft}${chars.horizontal.repeat(safeWidth - 2)}${chars.bottomRight}`,
  );

  const body = lines.map((line) => {
    const text = truncateToWidth(line, innerWidth, "");
    const padding = Math.max(0, innerWidth - visibleWidth(text));
    return `${border(chars.vertical)}${inset}${text}${" ".repeat(padding)}${inset}${border(chars.vertical)}`;
  });

  const framed = [top, ...body, bottom];
  if (overlaySurface === "transparent" || !colored) {
    return framed;
  }
  return framed.map((row) =>
    paintSurfaceLine(row, safeWidth, theme, overlaySurface, colored),
  );
}
