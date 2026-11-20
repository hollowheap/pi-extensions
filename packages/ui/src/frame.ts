import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Color,
  type TerminalColorMode,
  foregroundAnsi,
  indexedColor,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { type BorderStyle, getBorderChars } from "@hollowheap/core/border";
import type {
  OverlaySurfaceMode,
  PanelRenderMode,
} from "@hollowheap/core/tui-config";
import { getActiveTuiConfig, getHostOutputPadding } from "./state.js";
import { paintSurfaceLine, stripBackgroundSgr } from "./surface.js";
import { safeBold, safeFg } from "./theme.js";

export interface FrameOptions {
  borderStyle?: BorderStyle;
  overlaySurface?: OverlaySurfaceMode;
  colored?: boolean;
  paddingX?: number;
  bottomHint?: string;
}

function isSurfaceActive(
  overlaySurface: OverlaySurfaceMode,
  colored: boolean,
): boolean {
  return colored && overlaySurface !== "transparent";
}

function framePadding(
  width: number,
  _borderStyle: BorderStyle,
  paddingX?: number,
  _surfaceActive = false,
): number {
  if (width < 5) return 0;
  return paddingX ?? getHostOutputPadding() ?? 1;
}

function computeInnerWidth(
  safeWidth: number,
  _effectiveBorder: BorderStyle,
  paddingX: number,
): number {
  return Math.max(1, safeWidth - 2 - 2 * paddingX);
}

/** Return usable content width inside the selected border and padding. */
export function getFrameInnerWidth(
  width: number,
  borderStyle: BorderStyle = getActiveTuiConfig().borderStyle,
  paddingX?: number,
  overlaySurface: OverlaySurfaceMode = getActiveTuiConfig().overlaySurface,
  colored: boolean = getActiveTuiConfig().colored,
): number {
  const safeWidth = Math.max(4, width);
  const surfaceActive = isSurfaceActive(overlaySurface, colored);
  return computeInnerWidth(
    safeWidth,
    borderStyle,
    framePadding(width, borderStyle, paddingX, surfaceActive),
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
  const overlaySurface = options?.overlaySurface ?? active.overlaySurface;
  const colored = options?.colored ?? active.colored;
  const surfaceActive = isSurfaceActive(overlaySurface, colored);
  const borderStyle = options?.borderStyle ?? active.borderStyle;
  const paddingX = framePadding(
    safeWidth,
    borderStyle,
    options?.paddingX,
    surfaceActive,
  );
  const innerWidth = computeInnerWidth(safeWidth, borderStyle, paddingX);
  const inset = " ".repeat(paddingX);

  const border = (value: string) =>
    safeFg(theme, surfaceActive ? "borderAccent" : "border", value, colored);

  const chars =
    borderStyle === "none"
      ? {
          topLeft: " ",
          topRight: " ",
          bottomLeft: " ",
          bottomRight: " ",
          horizontal: " ",
          vertical: " ",
        }
      : getBorderChars(borderStyle);
  const rawLabel = title
    ? ` ${safeFg(theme, "accent", safeBold(theme, title), colored)} `
    : "";
  const label = truncateToWidth(rawLabel, Math.max(0, safeWidth - 3), "");
  const labelWidth = visibleWidth(label);
  const topFill = Math.max(0, safeWidth - 3 - labelWidth);
  const top =
    border(`${chars.topLeft}${chars.horizontal}`) +
    label +
    border(`${chars.horizontal.repeat(topFill)}${chars.topRight}`);
  let bottom: string;
  if (options?.bottomHint) {
    const rawHint = ` ${safeFg(theme, "dim", options.bottomHint, colored)} `;
    const truncatedHint = truncateToWidth(
      rawHint,
      Math.max(0, safeWidth - 3),
      "",
    );
    const bottomFill = Math.max(0, safeWidth - 3 - visibleWidth(truncatedHint));
    bottom =
      border(`${chars.bottomLeft}${chars.horizontal}`) +
      truncatedHint +
      border(`${chars.horizontal.repeat(bottomFill)}${chars.bottomRight}`);
  } else {
    bottom = border(
      `${chars.bottomLeft}${chars.horizontal.repeat(safeWidth - 2)}${chars.bottomRight}`,
    );
  }

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

export type PanelStateToken = "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

const STATE_FALLBACK_TOKEN: Readonly<
  Record<PanelStateToken, "accent" | "success" | "error">
> = {
  toolPendingBg: "accent",
  toolSuccessBg: "success",
  toolErrorBg: "error",
};

interface ColorTheme {
  colors?: Readonly<Record<string, Color | undefined>>;
  getColorMode?: () => TerminalColorMode;
}

/** ANSI 8 base colors become their brighter ANSI 16 variants for foreground use. */
function brightenBaseAnsi(color: Color): Color {
  return color.kind === "indexed" && color.index < 8
    ? indexedColor(color.index + 8)
    : color;
}

function stateAnsi(
  theme: Theme | undefined,
  token: PanelStateToken,
  colored: boolean,
): string | undefined {
  if (!colored || theme === undefined) return undefined;
  const candidate = theme as unknown as ColorTheme;
  const color = candidate.colors?.[token];
  if (color === undefined || typeof candidate.getColorMode !== "function") {
    return undefined;
  }
  return foregroundAnsi(brightenBaseAnsi(color), candidate.getColorMode());
}

function paintState(
  theme: Theme | undefined,
  token: PanelStateToken,
  colored: boolean,
  value: string,
  surfaceActive = false,
): string {
  const ansi = surfaceActive ? undefined : stateAnsi(theme, token, colored);
  if (ansi !== undefined) return `${ansi}${value}\x1b[39m`;
  const fallback = STATE_FALLBACK_TOKEN[token];
  return safeFg(theme, fallback, value, colored);
}

export function isPanelSurfaceActive(
  surface: OverlaySurfaceMode | undefined,
  colored: boolean,
): boolean {
  return colored && surface !== undefined && surface !== "transparent";
}

export function getPanelInnerWidth(
  width: number,
  _borderStyle: BorderStyle,
  accentStripe: boolean,
  outputPad: number,
  _surface?: OverlaySurfaceMode,
  _colored = true,
): number {
  const safeWidth = Math.max(4, width);
  const hasBorderSpace = safeWidth >= 6;
  return Math.max(
    1,
    safeWidth -
      (hasBorderSpace ? 2 : 0) -
      (accentStripe ? 1 : 0) -
      2 * outputPad,
  );
}

export interface PanelFrameLayout {
  safeWidth: number;
  colored: boolean;
  surface: OverlaySurfaceMode;
  surfaceActive: boolean;
  bordered: boolean;
  effectivePad: number;
  innerWidth: number;
}

export function resolvePanelFrameLayout(
  width: number,
  options: {
    mode?: PanelRenderMode;
    borderStyle: BorderStyle;
    accentStripe: boolean;
    outputPad: number;
    colored?: boolean;
    surface?: OverlaySurfaceMode;
  },
): PanelFrameLayout {
  const safeWidth = Math.max(4, width);
  const colored = options.colored ?? true;
  const surface = options.surface ?? "transparent";
  const surfaceActive = isPanelSurfaceActive(surface, colored);
  const bordered = options.borderStyle !== "none" && safeWidth >= 6;
  const effectivePad = options.outputPad;
  const innerWidth = getPanelInnerWidth(
    safeWidth,
    options.borderStyle,
    options.accentStripe,
    options.outputPad,
    surface,
    colored,
  );
  return {
    safeWidth,
    colored,
    surface,
    surfaceActive,
    bordered,
    effectivePad,
    innerWidth,
  };
}

export function fitRightLabel(
  line: string,
  width: number,
  label: string,
): string {
  if (width <= 0) return "";
  const text = truncateToWidth(label, width, "");
  const labelWidth = visibleWidth(text);
  const prefixWidth = Math.max(0, width - labelWidth);
  const prefix = sliceByColumn(line, 0, prefixWidth);
  const pad = Math.max(0, prefixWidth - visibleWidth(prefix));
  return `${prefix}\x1b[0m${" ".repeat(pad)}${text}`;
}

export function framePanelLines(
  lines: readonly string[],
  width: number,
  theme: Theme | undefined,
  options: {
    mode?: PanelRenderMode;
    borderStyle: BorderStyle;
    accentStripe: boolean;
    outputPad: number;
    stateToken: PanelStateToken;
    includeTop: boolean;
    includeBottom: boolean;
    colored?: boolean;
    surface?: OverlaySurfaceMode;
    borderToken?: "border" | "borderAccent";
    firstLinePrefix?: string;
    bottomRightLabel?: string;
  },
): string[] {
  const {
    safeWidth,
    colored,
    surface,
    surfaceActive,
    bordered,
    effectivePad,
    innerWidth,
  } = resolvePanelFrameLayout(width, options);
  const paint = (value: string) =>
    paintState(theme, options.stateToken, colored, value, surfaceActive);
  const stripe = options.accentStripe ? paint("▎") : "";
  const content =
    surface === "transparent"
      ? lines.map((line) => stripBackgroundSgr(line))
      : lines;
  const inset = " ".repeat(effectivePad);
  const firstPrefix = options.firstLinePrefix;
  const firstPrefixWidth =
    firstPrefix !== undefined ? visibleWidth(firstPrefix) : 0;
  const hasBorderSpace = safeWidth >= 6;
  const fitLineWidth = (targetWidth: number, line: string): string => {
    const safeLine =
      line.includes("\x1b[") && !line.endsWith("\x1b[0m")
        ? `${line}\x1b[0m`
        : line;
    return truncateToWidth(
      safeLine,
      Math.max(1, targetWidth),
      "",
      hasBorderSpace,
    );
  };

  if (!hasBorderSpace) {
    const rows: string[] = [];
    for (let index = 0; index < content.length; index++) {
      const line = content[index] ?? "";
      const prefix =
        firstPrefix !== undefined
          ? index === 0
            ? firstPrefix
            : " ".repeat(firstPrefixWidth)
          : "";
      const availWidth = Math.max(1, innerWidth - firstPrefixWidth);
      const row = `${stripe}${inset}${prefix}${fitLineWidth(availWidth, line)}${inset}`;
      rows.push(
        surface === "transparent"
          ? row
          : paintSurfaceLine(row, safeWidth, theme, surface, colored),
      );
    }
    if (options.includeBottom && options.bottomRightLabel) {
      const rightInset = Math.max(0, effectivePad - 1);
      const base = " ".repeat(safeWidth);
      const footer =
        fitRightLabel(
          base,
          Math.max(0, safeWidth - rightInset),
          options.bottomRightLabel,
        ) + " ".repeat(rightInset);
      rows.push(
        surface === "transparent"
          ? footer
          : paintSurfaceLine(footer, safeWidth, theme, surface, colored),
      );
    }
    return rows;
  }

  const chars = bordered
    ? getBorderChars(options.borderStyle)
    : {
        topLeft: " ",
        topRight: " ",
        bottomLeft: " ",
        bottomRight: " ",
        horizontal: " ",
        vertical: " ",
      };
  const labelPaint =
    options.borderToken !== undefined
      ? (value: string) =>
          safeFg(theme, options.borderToken ?? "border", value, colored)
      : paint;
  const borderPaint = bordered ? labelPaint : (value: string) => value;
  const out: string[] = [];

  if (options.includeTop) {
    out.push(
      borderPaint(
        `${chars.topLeft}${chars.horizontal.repeat(safeWidth - 2)}${chars.topRight}`,
      ),
    );
  }

  const leftEdge = borderPaint(chars.vertical) + stripe + inset;
  const rightEdge = inset + borderPaint(chars.vertical);
  const normalLeftWidth = 1 + (options.accentStripe ? 1 : 0) + effectivePad;

  for (let index = 0; index < content.length; index++) {
    const line = content[index] ?? "";
    if (index === 0 && firstPrefix !== undefined) {
      const firstLineWidth = Math.max(
        1,
        innerWidth + normalLeftWidth - firstPrefixWidth,
      );
      out.push(
        `${firstPrefix}${fitLineWidth(firstLineWidth, line)}${rightEdge}`,
      );
    } else {
      out.push(`${leftEdge}${fitLineWidth(innerWidth, line)}${rightEdge}`);
    }
  }

  if (options.includeBottom) {
    const bottomInnerWidth = safeWidth - 2;
    if (options.bottomRightLabel && bottomInnerWidth > 0) {
      const inner = borderPaint(chars.horizontal.repeat(bottomInnerWidth));
      const label = `${labelPaint(options.bottomRightLabel)}${borderPaint(chars.horizontal)}`;
      out.push(
        borderPaint(chars.bottomLeft) +
          fitRightLabel(inner, bottomInnerWidth, label) +
          borderPaint(chars.bottomRight),
      );
    } else {
      out.push(
        borderPaint(
          `${chars.bottomLeft}${chars.horizontal.repeat(bottomInnerWidth)}${chars.bottomRight}`,
        ),
      );
    }
  }

  return surface === "transparent"
    ? out
    : out.map((row) =>
        paintSurfaceLine(row, safeWidth, theme, surface, colored),
      );
}
