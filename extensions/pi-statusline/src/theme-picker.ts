import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { canOverlay, hostUi, notify } from "@hollowheap/pi-ui/host";
import { showFuzzyPicker } from "@hollowheap/pi-ui/picker";

export async function showThemePicker(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  if (!canOverlay(ctx)) return undefined;
  const ui = hostUi(ctx);
  if (ui === undefined) return undefined;
  const themes = ui.getAllThemes();
  if (themes.length === 0) return undefined;
  const current = ui.theme;
  const currentName = current.name;
  let previewed: string | undefined = currentName;

  return showFuzzyPicker(ctx, {
    title: "Select a statusline preset",
    maxVisible: 12,
    initialValue: currentName,
    emptyText: "No themes",
    header: () => [`Preview: ${previewed ?? ""}`],
    hint: "↑↓ move  Enter select  Esc cancel",
    mouseOffset: { x: 2, y: 3 },
    items: themes.map((entry) => ({
      value: entry.name,
      label: entry.name,
      description: entry.path ?? "built-in theme",
    })),
    resolveValue: () => previewed,
    onSelectionChange: (item) => {
      const result = ui.setTheme(item.value);
      if (result.success) {
        previewed = item.value;
      } else if (ctx.hasUI) {
        notify(
          ctx,
          `pi-statusline: ${result.error ?? "could not preview theme"}`,
          "error",
        );
      }
    },
    onCancel: () => {
      if (currentName !== undefined) ui.setTheme(currentName);
      else ui.setTheme(current);
    },
  });
}
