import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  decodeKittyPrintable,
  fuzzyFilter,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";

export interface FuzzyPickerItem extends SelectItem {
  preview?: string[];
}

export interface FuzzyPickerOptions {
  title: string;
  items: readonly FuzzyPickerItem[];
  emptyText?: string;
}

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

/** Show a fuzzy-searchable SelectList overlay. Returns the chosen value. */
export async function showFuzzyPicker(
  ctx: ExtensionContext,
  options: FuzzyPickerOptions,
): Promise<string | undefined> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return undefined;
  }

  const allItems = [...options.items];
  return withPromptLock(() =>
    ctx.ui.custom<string | undefined>(
      (tui, theme, _keybindings, done) => {
        let query = "";
        let settled = false;
        let selected: FuzzyPickerItem | undefined;
        let list: SelectList;

        const finish = (value: string | undefined): void => {
          if (settled) return;
          settled = true;
          done(value);
        };

        const rebuild = (): void => {
          const filtered = query
            ? fuzzyFilter(
                allItems,
                query,
                (item) => `${item.label} ${item.description ?? ""}`,
              )
            : allItems;
          list = new SelectList(
            filtered,
            Math.max(3, Math.min(filtered.length, 8)),
            selectTheme(theme),
          );
          list.onSelectionChange = (item) => {
            selected = item as FuzzyPickerItem;
            tui.requestRender();
          };
          list.onSelect = (item) => finish(item.value);
          list.onCancel = () => finish(undefined);
          selected =
            (list.getSelectedItem() as FuzzyPickerItem | null) ?? undefined;
        };

        const preview = (): string[] => {
          if (!selected) {
            return [theme.fg("muted", options.emptyText ?? "No matches")];
          }
          if (selected.preview && selected.preview.length > 0) {
            return selected.preview.map((line, index) =>
              index === 0
                ? theme.fg("accent", theme.bold(line))
                : theme.fg("muted", line),
            );
          }
          return selected.description
            ? [theme.fg("muted", selected.description)]
            : [];
        };

        rebuild();
        return {
          render(width: number): string[] {
            const lines = [
              theme.fg("accent", theme.bold(options.title)),
              theme.fg(
                "muted",
                query === "" ? "Filter: (type to search)" : `Filter: ${query}`,
              ),
              ...list.render(width),
              "",
              ...preview(),
              "",
              theme.fg(
                "dim",
                "↑↓ move  Enter select  Esc cancel  type to filter",
              ),
            ];
            return lines.map((line) => truncateToWidth(line, width, ""));
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
          maxHeight: "75%",
          margin: 1,
        },
      },
    ),
  );
}
