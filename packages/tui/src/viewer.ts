import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { getBorderChars } from "@hollowheap/core/border";
import { getActiveTuiConfig } from "./state.js";
import { paintSurfaceLine } from "./surface.js";

function padToWidth(line: string, width: number): string {
  const padding = width - visibleWidth(line);
  return padding > 0 ? line + " ".repeat(padding) : line;
}

export async function showCodeViewer(
  ctx: ExtensionContext,
  title: string,
  code: string,
): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  const codeLines = code.replace(/\r/g, "").split("\n");
  let offset = 0;

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const getTheme = (): Theme =>
        (ctx.ui as { theme?: Theme } | undefined)?.theme ?? theme;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        done();
      };
      const border = (value: string) =>
        getActiveTuiConfig().colored ? getTheme().fg("border", value) : value;
      const titlePaint = (value: string) => {
        const bolded = getTheme().bold(value);
        return getActiveTuiConfig().colored
          ? getTheme().fg("accent", bolded)
          : bolded;
      };
      const dimPaint = (value: string) =>
        getActiveTuiConfig().colored ? getTheme().fg("dim", value) : value;

      const viewportHeight = (): number =>
        Math.max(1, Math.floor(tui.terminal.rows * 0.8) - 2);
      const maxOffset = (): number =>
        Math.max(0, codeLines.length - viewportHeight());

      return {
        capturesViewportInput: true,
        render(width: number): string[] {
          const safeWidth = Math.max(4, width);
          const { borderStyle, overlaySurface, colored } = getActiveTuiConfig();
          const height = viewportHeight();
          offset = Math.max(0, Math.min(offset, maxOffset()));
          const visible = codeLines.slice(offset, offset + height);
          const hint =
            codeLines.length > height
              ? ` ↑↓ scroll ${offset + 1}/${codeLines.length} · Esc close `
              : " Esc close ";

          if (borderStyle === "none") {
            const top = paintSurfaceLine(
              truncateToWidth(titlePaint(title), safeWidth, ""),
              safeWidth,
              getTheme(),
              overlaySurface,
              colored,
            );
            const content = visible.map((line) =>
              paintSurfaceLine(
                truncateToWidth(line, safeWidth, ""),
                safeWidth,
                getTheme(),
                overlaySurface,
                colored,
              ),
            );
            while (content.length < height) {
              content.push(
                paintSurfaceLine(
                  "",
                  safeWidth,
                  getTheme(),
                  overlaySurface,
                  colored,
                ),
              );
            }
            const bottom = paintSurfaceLine(
              truncateToWidth(dimPaint(hint.trim()), safeWidth, ""),
              safeWidth,
              getTheme(),
              overlaySurface,
              colored,
            );
            return [top, ...content, bottom];
          }

          const chars = getBorderChars(borderStyle);
          const codeWidth = Math.max(1, safeWidth - 4);
          const header = truncateToWidth(
            ` ${titlePaint(title)} `,
            Math.max(0, safeWidth - 3),
            "",
          );
          const topFill = Math.max(0, safeWidth - 2 - visibleWidth(header) - 1);
          const top =
            border(`${chars.topLeft}${chars.horizontal}`) +
            header +
            border(`${chars.horizontal.repeat(topFill)}${chars.topRight}`);

          const content = visible.map((line) => {
            const text = truncateToWidth(line, codeWidth, "");
            return `${border(chars.vertical)} ${padToWidth(text, codeWidth)} ${border(chars.vertical)}`;
          });
          while (content.length < height) {
            content.push(
              `${border(chars.vertical)} ${" ".repeat(codeWidth)} ${border(chars.vertical)}`,
            );
          }

          const bottomFill = Math.max(
            0,
            safeWidth - 2 - visibleWidth(hint) - 1,
          );
          const bottom =
            border(`${chars.bottomLeft}${chars.horizontal}`) +
            dimPaint(hint) +
            border(
              `${chars.horizontal.repeat(bottomFill)}${chars.bottomRight}`,
            );

          const rows = [top, ...content, bottom];
          if (overlaySurface === "transparent" || !colored) {
            return rows;
          }
          return rows.map((row) =>
            paintSurfaceLine(
              row,
              safeWidth,
              getTheme(),
              overlaySurface,
              colored,
            ),
          );
        },
        handleInput(data: string): void {
          if (
            matchesKey(data, "escape") ||
            matchesKey(data, "enter") ||
            data === "q"
          ) {
            finish();
            return;
          }
          if (matchesKey(data, "up") || data === "k") {
            offset = Math.max(0, offset - 1);
          } else if (matchesKey(data, "down") || data === "j") {
            offset = Math.min(maxOffset(), offset + 1);
          } else if (matchesKey(data, "pageUp")) {
            offset = Math.max(0, offset - viewportHeight());
          } else if (matchesKey(data, "pageDown")) {
            offset = Math.min(maxOffset(), offset + viewportHeight());
          } else if (matchesKey(data, "home") || data === "g") {
            offset = 0;
          } else if (matchesKey(data, "end") || data === "G") {
            offset = maxOffset();
          } else {
            return;
          }
          tui.requestRender();
        },
        invalidate(): void {
          tui.requestRender();
        },
        dispose(): void {
          finish();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "80%", maxHeight: "80%", margin: 1 },
    },
  );
}
