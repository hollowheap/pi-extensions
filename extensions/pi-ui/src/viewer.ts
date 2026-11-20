import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { boxFrame } from "@hollowheap/ui/frame";
import { hostUi, showDialog } from "./host.js";
import { handleViewportKey } from "./viewport.js";

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

      const viewportHeight = (): number =>
        Math.max(1, Math.floor(tui.terminal.rows * 0.8) - 2);
      const maxOffset = (): number =>
        Math.max(0, codeLines.length - viewportHeight());

      return {
        capturesViewportInput: true,
        render(width: number): string[] {
          const height = viewportHeight();
          offset = Math.max(0, Math.min(offset, maxOffset()));
          const content = codeLines.slice(offset, offset + height);
          while (content.length < height) {
            content.push("");
          }
          const bottomHint =
            codeLines.length > height
              ? `↑↓ scroll ${offset + 1}/${codeLines.length} · Esc close`
              : "Esc close";
          return boxFrame(content, width, getTheme(), title, { bottomHint });
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
            pageSize: viewportHeight,
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
