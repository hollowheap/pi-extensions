import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  SelectList,
  type SelectListTheme,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { roundedFrame } from "@hollowheap/tui/frame";

function pickerTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("muted", text),
    noMatch: (text) => theme.fg("muted", text),
  };
}

export async function showThemePicker(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return undefined;
  }
  const themes = ctx.ui.getAllThemes();
  if (themes.length === 0) return undefined;
  const current = ctx.ui.theme;
  const currentName = current.name;
  return await withPromptLock(() =>
    ctx.ui.custom<string | undefined>(
      (_tui, theme, _keybindings, done) => {
        let settled = false;
        let previewed: string | undefined = currentName;
        const list = new SelectList(
          themes.map((entry) => ({
            value: entry.name,
            label: entry.name,
            description:
              entry.path === undefined ? "built-in theme" : entry.path,
          })),
          Math.min(themes.length, 12),
          pickerTheme(theme),
        );
        const currentIndex = themes.findIndex(
          (entry) => entry.name === current.name,
        );
        if (currentIndex >= 0) list.setSelectedIndex(currentIndex);

        const settle = (value: string | undefined) => {
          if (settled) return;
          settled = true;
          done(value);
        };
        const cancel = () => {
          if (settled) return;
          if (currentName !== undefined) ctx.ui.setTheme(currentName);
          else ctx.ui.setTheme(current);
          settle(undefined);
        };

        list.onSelect = () => settle(previewed);
        list.onCancel = cancel;
        list.onSelectionChange = (item) => {
          const result = ctx.ui.setTheme(item.value);
          if (result.success) {
            previewed = item.value;
          } else if (ctx.hasUI) {
            ctx.ui.notify(
              `pi-statusline: ${result.error ?? "could not preview theme"}`,
              "error",
            );
          }
        };
        return {
          render(width: number): string[] {
            const innerWidth = Math.max(1, width - 4);
            const lines = [
              theme.fg("muted", `Preview: ${previewed}`),
              "",
              ...list.render(innerWidth),
              "",
              theme.fg("dim", "↑↓ move  Enter select  Esc cancel"),
            ];
            return roundedFrame(
              lines,
              width,
              theme,
              "Select a statusline preset",
            );
          },
          handleInput(data: string): void {
            list.handleInput(data);
          },
          handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
            return list.handleMouse({
              ...event,
              x: event.x - 2,
              y: event.y - 3,
            });
          },
          invalidate(): void {
            list.invalidate();
          },
          dispose(): void {
            cancel();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: { width: "60%", maxHeight: "70%", margin: 1 },
      },
    ),
  );
}
