import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { getBorderChars } from "@hollowheap/core/border";
import { getActiveTuiConfig, getHostOutputPadding } from "@hollowheap/ui/state";
import { paintSurfaceLine } from "@hollowheap/ui/surface";
import { hostUi, showDialog } from "./host.js";

export async function showCodeViewer(
  ctx: ExtensionContext,
  title: string,
  code: string,
): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  const codeLines = code.replace(/\r/g, "").split("\n");
  let offset = 0;

  await showDialog<void>(
    ctx,
    (tui, theme, _keybindings, done) => {
      const getTheme = (): Theme => hostUi(ctx)?.theme ?? theme;
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
          const surfaceActive = colored && overlaySurface !== "transparent";
          const effectiveBorderStyle = surfaceActive ? "none" : borderStyle;
          const height = viewportHeight();
          offset = Math.max(0, Math.min(offset, maxOffset()));
          const visible = codeLines.slice(offset, offset + height);
          const hint =
            codeLines.length > height
              ? ` ↑↓ scroll ${offset + 1}/${codeLines.length} · Esc close `
              : " Esc close ";

          if (effectiveBorderStyle === "none") {
            const padX = surfaceActive ? (getHostOutputPadding() ?? 0) + 1 : 0;
            const inset = " ".repeat(padX);
            const innerWidth = Math.max(1, safeWidth - 2 * padX);
            const paintLine = (text: string) =>
              paintSurfaceLine(
                inset + truncateToWidth(text, innerWidth, ""),
                safeWidth,
                getTheme(),
                overlaySurface,
                colored,
              );
            const top = paintLine(titlePaint(title));
            const content = visible.map(paintLine);
            while (content.length < height) {
              content.push(paintLine(""));
            }
            const bottom = paintLine(dimPaint(hint.trim()));
            return [top, ...content, bottom];
          }

          const chars = getBorderChars(effectiveBorderStyle);
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
            const text = truncateToWidth(line, codeWidth, "", true);
            return `${border(chars.vertical)} ${text} ${border(chars.vertical)}`;
          });
          while (content.length < height) {
            content.push(
              `${border(chars.vertical)} ${" ".repeat(codeWidth)} ${border(chars.vertical)}`,
            );
          }

          const truncatedHint = truncateToWidth(
            dimPaint(hint),
            Math.max(0, safeWidth - 3),
            "",
          );
          const bottomFill = Math.max(
            0,
            safeWidth - 2 - visibleWidth(truncatedHint) - 1,
          );
          const bottom =
            border(`${chars.bottomLeft}${chars.horizontal}`) +
            truncatedHint +
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
