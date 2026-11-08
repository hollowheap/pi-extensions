import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  decodeKittyPrintable,
  fuzzyFilter,
  matchesKey,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { roundedFrame } from "@hollowheap/tui/frame";

function selectTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("muted", text),
    noMatch: (text) => theme.fg("muted", text),
  };
}

function printableKey(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  if (data.length !== 1) return undefined;
  const code = data.charCodeAt(0);
  return code >= 32 && code !== 127 ? data : undefined;
}

/** Pick a recently checked permission target with fuzzy search. */
export async function showTargetPicker(
  ctx: ExtensionContext,
  targets: readonly string[],
): Promise<string | undefined> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return undefined;
  }
  const allItems: SelectItem[] = targets.map((target) => ({
    value: target,
    label: target,
    description: "recent permission target",
  }));
  return withPromptLock(() =>
    ctx.ui.custom<string | undefined>(
      (tui, theme, _keybindings, done) => {
        let query = "";
        let settled = false;
        let selected: SelectItem | undefined;
        let list: SelectList;

        const finish = (value: string | undefined): void => {
          if (settled) return;
          settled = true;
          done(value);
        };

        const rebuild = (): void => {
          const filtered = query
            ? fuzzyFilter(allItems, query, (item) => item.label)
            : allItems;
          list = new SelectList(
            filtered,
            Math.max(3, Math.min(filtered.length, 8)),
            selectTheme(theme),
          );
          list.onSelectionChange = (item) => {
            selected = item;
            tui.requestRender();
          };
          list.onSelect = (item) => finish(item.value);
          list.onCancel = () => finish(undefined);
          selected = list.getSelectedItem() ?? undefined;
        };

        rebuild();
        return {
          render(width: number): string[] {
            const innerWidth = Math.max(1, width - 4);
            const lines = [
              theme.fg(
                "muted",
                query === "" ? "Filter: (type to search)" : `Filter: ${query}`,
              ),
              ...list.render(innerWidth),
              "",
              theme.fg("dim", `target: ${selected?.value ?? "none"}`),
              "",
              theme.fg(
                "dim",
                "↑↓ move  Enter select  Esc cancel  type to filter",
              ),
            ];
            return roundedFrame(
              lines,
              width,
              theme,
              "Grant temporary permission",
            );
          },
          invalidate(): void {
            list.invalidate();
          },
          handleInput(data: string): void {
            if (matchesKey(data, Key.backspace)) {
              if (query !== "") {
                query = query.slice(0, -1);
                rebuild();
                tui.requestRender();
              }
              return;
            }
            const printable = printableKey(data);
            if (printable !== undefined) {
              query += printable;
              rebuild();
              tui.requestRender();
              return;
            }
            list.handleInput(data);
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: "70%",
          maxHeight: "70%",
          margin: 1,
        },
      },
    ),
  );
}
