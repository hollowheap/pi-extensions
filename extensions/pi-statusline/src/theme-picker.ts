import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  SelectList,
  type SelectListTheme,
  truncateToWidth,
} from "@earendil-works/pi-tui";

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
  return ctx.ui.custom<string | undefined>(
    (_tui, theme, _keybindings, done) => {
      let selected = current.name;
      const list = new SelectList(
        themes.map((entry) => ({
          value: entry.name,
          label: entry.name,
          description: entry.path === undefined ? "built-in theme" : entry.path,
        })),
        Math.min(themes.length, 12),
        pickerTheme(theme),
      );
      const currentIndex = themes.findIndex(
        (entry) => entry.name === current.name,
      );
      if (currentIndex >= 0) list.setSelectedIndex(currentIndex);
      list.onSelect = (item) => done(item.value);
      list.onCancel = () => {
        ctx.ui.setTheme(current);
        done(undefined);
      };
      list.onSelectionChange = (item) => {
        selected = item.value;
        const result = ctx.ui.setTheme(item.value);
        if (!result.success && ctx.hasUI) {
          ctx.ui.notify(
            `pi-statusline: ${result.error ?? "could not preview theme"}`,
            "error",
          );
        }
      };
      return {
        render(width: number): string[] {
          const lines = [
            theme.fg("accent", theme.bold("Select theme")),
            theme.fg("muted", `Preview: ${selected}`),
            "",
            ...list.render(width),
            "",
            theme.fg("dim", "↑↓ move  Enter select  Esc cancel"),
          ];
          return lines.map((line) => truncateToWidth(line, width, ""));
        },
        handleInput(data: string): void {
          list.handleInput(data);
        },
        invalidate(): void {
          list.invalidate();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "60%", maxHeight: "70%", margin: 1 },
    },
  );
}
