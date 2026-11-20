import type { Theme, ThemeBg } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { OverlaySurfaceMode } from "@hollowheap/core/tui-config";
import { getActiveTuiConfig } from "./state.js";

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;:]*)m`, "g");
const SGR_HAZARD = new RegExp(
  `${ESC}\\[(?:[0-9;:]*[;:])?(?:0|4[0-9]|10[0-7]|48)(?:[;:][0-9;:]*)?m`,
);
const SGR_BARE_RESET = new RegExp(
  `${ESC}\\[(?:|;[0-9;:]*|[0-9;:]*;|[0-9;:]*;;[0-9;:]*)m`,
);
const SGR_DIM = new RegExp(`${ESC}\\[(?:[0-9;:]*[;:])?2(?:[;:][0-9;:]*)?m`);
const LEADING_SGR = new RegExp(`^${ESC}\\[[0-9;:]+m`);

/** Remove inherited background colors and restore the surface after full resets. */
export function stripBackgroundSgr(text: string, surfaceAnsi = ""): string {
  if (
    !text.includes(ESC) ||
    (!SGR_HAZARD.test(text) &&
      (surfaceAnsi === "" ||
        (!SGR_BARE_RESET.test(text) && !SGR_DIM.test(text))))
  ) {
    return text;
  }
  return text.replace(SGR, (_match, params: string) => {
    const parts = params.split(";");
    const kept: string[] = [];
    let resetBackground = false;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const code = Number.parseInt(part || "0", 10);
      if (code === 38 || code === 48 || code === 58) {
        const mode = parts[index + 1];
        const size = part.includes(":")
          ? 1
          : mode === "5"
            ? 3
            : mode === "2"
              ? 5
              : 1;
        if (code !== 48) kept.push(...parts.slice(index, index + size));
        index += size - 1;
      } else if (
        (code < 40 || code > 49) &&
        (code < 100 || code > 107) &&
        !(surfaceAnsi !== "" && code === 2)
      ) {
        kept.push(part);
        if (code === 0) resetBackground = true;
      }
    }
    const foreground = kept.length === 0 ? "" : `\x1b[${kept.join(";")}m`;
    return foreground + (resetBackground ? surfaceAnsi : "");
  });
}

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
  const padded =
    visibleWidth(line) === safeWidth
      ? line
      : truncateToWidth(line, safeWidth, "", true);
  const token = getSurfaceBgToken(mode);
  if (!colored || token === undefined || typeof theme?.bg !== "function") {
    return padded;
  }
  const painted = theme.bg(token, padded);
  const ansi = LEADING_SGR.exec(painted)?.[0];
  if (ansi === undefined || !painted.startsWith(ansi + padded)) return painted;
  return (
    ansi +
    stripBackgroundSgr(padded, ansi) +
    painted.slice(ansi.length + padded.length)
  );
}
