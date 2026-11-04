import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const HORIZONTAL = "─";
const TOP_LEFT = "╭";
const TOP_RIGHT = "╮";
const BOTTOM_LEFT = "╰";
const BOTTOM_RIGHT = "╯";
const VERTICAL = "│";

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
      const border = (value: string) => theme.fg("border", value);
      const titlePaint = (value: string) =>
        theme.fg("accent", theme.bold(value));

      const viewportHeight = (): number =>
        Math.max(1, Math.floor(tui.terminal.rows * 0.8) - 2);
      const maxOffset = (): number =>
        Math.max(0, codeLines.length - viewportHeight());

      return {
        render(width: number): string[] {
          const safeWidth = Math.max(4, width);
          const codeWidth = Math.max(1, safeWidth - 4);
          const height = viewportHeight();
          offset = Math.max(0, Math.min(offset, maxOffset()));
          const visible = codeLines.slice(offset, offset + height);

          const header = truncateToWidth(
            ` ${titlePaint(title)} `,
            Math.max(0, safeWidth - 3),
            "",
          );
          const topFill = Math.max(0, safeWidth - 2 - visibleWidth(header) - 1);
          const top =
            border(`${TOP_LEFT}${HORIZONTAL}`) +
            header +
            border(`${HORIZONTAL.repeat(topFill)}${TOP_RIGHT}`);

          const content = visible.map((line) => {
            const text = truncateToWidth(line, codeWidth, "");
            return `${border(VERTICAL)} ${padToWidth(text, codeWidth)} ${border(VERTICAL)}`;
          });
          while (content.length < height) {
            content.push(
              `${border(VERTICAL)} ${" ".repeat(codeWidth)} ${border(VERTICAL)}`,
            );
          }

          const hint =
            codeLines.length > height
              ? ` ↑↓ scroll ${offset + 1}/${codeLines.length} · Esc close `
              : " Esc close ";
          const bottomFill = Math.max(
            0,
            safeWidth - 2 - visibleWidth(hint) - 1,
          );
          const bottom =
            border(`${BOTTOM_LEFT}${HORIZONTAL}`) +
            theme.fg("dim", hint) +
            border(`${HORIZONTAL.repeat(bottomFill)}${BOTTOM_RIGHT}`);

          return [top, ...content, bottom];
        },
        handleInput(data: string): void {
          if (
            matchesKey(data, "escape") ||
            matchesKey(data, "enter") ||
            data === "q"
          ) {
            done();
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
        invalidate(): void {},
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "80%", maxHeight: "80%", margin: 1 },
    },
  );
}
