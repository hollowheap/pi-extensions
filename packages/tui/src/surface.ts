import type { Theme, ThemeBg } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { OverlaySurfaceMode } from "@hollowheap/core/tui-config";
import { getActiveTuiConfig } from "./state.js";

/** Map an overlay surface mode to its background theme token, or `undefined` for transparent. */
export function getSurfaceBgToken(
  mode: OverlaySurfaceMode,
): ThemeBg | undefined {
  switch (mode) {
    case "surface":
      return "customMessageBg";
    case "card":
      return "userMessageBg";
    case "contrast":
      return "selectedBg";
    default:
      return undefined;
  }
}

/** Pad `line` to `width` and wrap it with the active overlay surface background when set. */
export function paintSurfaceLine(
  line: string,
  width: number,
  theme?: Pick<Theme, "bg">,
  mode: OverlaySurfaceMode = getActiveTuiConfig().overlaySurface,
  colored: boolean = getActiveTuiConfig().colored,
): string {
  const safeWidth = Math.max(0, width);
  const fitted =
    visibleWidth(line) > safeWidth
      ? truncateToWidth(line, safeWidth, "")
      : line;
  const padding = Math.max(0, safeWidth - visibleWidth(fitted));
  const padded = padding > 0 ? `${fitted}${" ".repeat(padding)}` : fitted;
  const token = getSurfaceBgToken(mode);
  if (!colored || token === undefined || typeof theme?.bg !== "function") {
    return padded;
  }
  return theme.bg(token, padded);
}
