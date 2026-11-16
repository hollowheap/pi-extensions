import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type BorderStyle, getBorderChars } from "@hollowheap/core/border";
import type { OverlaySurfaceMode } from "@hollowheap/core/tui-config";
import { getActiveTuiConfig } from "./state.js";
import { paintSurfaceLine } from "./surface.js";

export interface FrameOptions {
  borderStyle?: BorderStyle;
  overlaySurface?: OverlaySurfaceMode;
  colored?: boolean;
}

/** Return usable content width inside a frame for the active border style. */
export function getFrameInnerWidth(
  width: number,
  borderStyle?: BorderStyle,
): number {
  const safeWidth = Math.max(4, width);
  const effective = borderStyle ?? getActiveTuiConfig().borderStyle;
  return effective === "none" ? safeWidth : Math.max(1, safeWidth - 4);
}

/** Draw a configurable box around already-rendered lines. */
export function roundedFrame(
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
        safeWidth,
        "",
      );
      rows.push(
        paintSurfaceLine(titleLine, safeWidth, theme, overlaySurface, colored),
      );
    }
    for (const line of lines) {
      const fitted = truncateToWidth(line, safeWidth, "");
      rows.push(
        paintSurfaceLine(fitted, safeWidth, theme, overlaySurface, colored),
      );
    }
    return rows;
  }

  const chars = getBorderChars(borderStyle);
  const innerWidth = safeWidth - 4;
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
    return `${border(chars.vertical)} ${text}${" ".repeat(padding)} ${border(chars.vertical)}`;
  });

  const framed = [top, ...body, bottom];
  if (overlaySurface === "transparent" || !colored) {
    return framed;
  }
  return framed.map((row) =>
    paintSurfaceLine(row, safeWidth, theme, overlaySurface, colored),
  );
}
