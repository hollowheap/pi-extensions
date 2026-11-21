import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  frameOverlay,
  overlayTheme,
  settledGuard,
  showDialog,
} from "./host.js";
import { handleViewportKey, viewportHeight } from "./viewport.js";

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
      const getTheme = overlayTheme(ctx, theme);
      const guard = settledGuard();
      const finish = (): void => {
        if (!guard.settle()) return;
        done();
      };

      const visibleHeight = (): number => viewportHeight(tui.terminal.rows);
      const maxOffset = (): number =>
        Math.max(0, codeLines.length - visibleHeight());

      return {
        capturesViewportInput: true,
        render(width: number): string[] {
          const height = visibleHeight();
          offset = Math.max(0, Math.min(offset, maxOffset()));
          const content = codeLines.slice(offset, offset + height);
          while (content.length < height) {
            content.push("");
          }
          const bottomHint =
            codeLines.length > height
              ? `↑↓ scroll ${offset + 1}/${codeLines.length} · Esc close`
              : "Esc close";
          return frameOverlay(width, getTheme(), title, () => content, {
            bottomHint,
          });
        },
        handleInput(data: string): void {
          const handled = handleViewportKey(data, {
            onClose: finish,
            onScrollBy: (delta) => {
              offset = Math.max(0, Math.min(maxOffset(), offset + delta));
              tui.requestRender();
            },
            onScrollTo: (next) => {
              offset = Math.max(0, Math.min(maxOffset(), next));
              tui.requestRender();
            },
            pageSize: visibleHeight,
            maxOffset,
            closeOnEnter: true,
          });
          if (!handled) return;
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
