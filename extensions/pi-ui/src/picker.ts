import type {
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type TuiMouseEvent,
  fuzzyFilter,
  matchesKey,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { decodePrintableInput } from "@hollowheap/ui/input";
import {
  getActiveTuiConfig,
  subscribeActiveTuiConfig,
} from "@hollowheap/ui/state";
import { safeBold, safeFg } from "@hollowheap/ui/theme";
import {
  canOverlay,
  frameOverlay,
  overlayTheme,
  settledGuard,
  showDialog,
} from "./host.js";

export interface FuzzyPickerItem extends SelectItem {
  preview?: string[];
  searchText?: string;
}

export interface FuzzyPickerOptions {
  title: string;
  items: readonly FuzzyPickerItem[];
  emptyText?: string;
  maxVisible?: number;
  initialValue?: string;
  header?: (query: string, selected: FuzzyPickerItem | undefined) => string[];
  hint?: string;
  mouseOffset?: { x: number; y: number };
  onSelectionChange?: (item: FuzzyPickerItem) => void;
  resolveValue?: (item: FuzzyPickerItem) => string | undefined;
  onCancel?: () => void;
}

export function selectListTheme(
  theme: Theme | undefined,
  colored = true,
  scrollToken: ThemeColor = "muted",
): SelectListTheme {
  const fg = (token: ThemeColor, text: string) =>
    safeFg(theme, token, text, colored);
  return {
    selectedPrefix: (text) => fg("accent", text),
    selectedText: (text) => fg("accent", text),
    description: (text) => fg("muted", text),
    scrollInfo: (text) => fg(scrollToken, text),
    noMatch: (text) => fg("muted", text),
  };
}

/** Show a fuzzy-searchable SelectList overlay. Returns the chosen value. */
export async function showFuzzyPicker(
  ctx: ExtensionContext,
  options: FuzzyPickerOptions,
): Promise<string | undefined> {
  if (!canOverlay(ctx)) {
    return undefined;
  }

  const allItems = [...options.items];
  return withPromptLock(() =>
    showDialog<string | undefined>(
      ctx,
      (tui, theme, _keybindings, done) => {
        const getTheme = overlayTheme(ctx, theme);
        let query = "";
        const guard = settledGuard();
        let selected: FuzzyPickerItem | undefined;
        let list: SelectList;
        let unsubscribe = (): void => {};
        let initialApplied = false;

        const finish = (value: string | undefined): void => {
          if (!guard.settle()) return;
          unsubscribe();
          if (value === undefined) options.onCancel?.();
          done(value);
        };

        const rebuild = (): void => {
          const filtered = query
            ? fuzzyFilter(
                allItems,
                query,
                (item) =>
                  item.searchText ?? `${item.label} ${item.description ?? ""}`,
              )
            : allItems;
          list = new SelectList(
            filtered,
            Math.max(3, Math.min(filtered.length, options.maxVisible ?? 8)),
            selectListTheme(getTheme(), getActiveTuiConfig().colored),
          );
          list.onSelectionChange = (item) => {
            selected = item as FuzzyPickerItem;
            options.onSelectionChange?.(selected);
            tui.requestRender();
          };
          list.onSelect = (item) =>
            finish(options.resolveValue?.(item) ?? item.value);
          list.onCancel = () => finish(undefined);
          selected =
            (list.getSelectedItem() as FuzzyPickerItem | null) ?? undefined;
          if (
            !initialApplied &&
            query === "" &&
            options.initialValue !== undefined
          ) {
            const index = allItems.findIndex(
              (item) => item.value === options.initialValue,
            );
            if (index >= 0) {
              list.setSelectedIndex(index);
              selected = allItems[index];
            }
            initialApplied = true;
          }
        };

        const fg = (token: ThemeColor, text: string) =>
          safeFg(getTheme(), token, text, getActiveTuiConfig().colored);

        const preview = (): string[] => {
          if (!selected) {
            return [fg("muted", options.emptyText ?? "No matches")];
          }
          if (selected.preview && selected.preview.length > 0) {
            return selected.preview.map((line, index) =>
              index === 0
                ? fg("accent", safeBold(getTheme(), line))
                : fg("muted", line),
            );
          }
          return selected.description
            ? [fg("muted", selected.description)]
            : [];
        };

        const refreshStyles = (): void => {
          if (guard.isSettled()) return;
          rebuild();
          tui.requestRender();
        };
        unsubscribe = subscribeActiveTuiConfig(refreshStyles);
        rebuild();
        return {
          render(width: number): string[] {
            const header = options.header
              ? options.header(query, selected)
              : [
                  fg(
                    "muted",
                    query === ""
                      ? "Filter: (type to search)"
                      : `Filter: ${query}`,
                  ),
                ];
            return frameOverlay(
              width,
              getTheme(),
              options.title,
              (innerWidth) => [
                ...header,
                ...list.render(innerWidth),
                "",
                ...preview(),
                "",
                fg(
                  "dim",
                  options.hint ??
                    "↑↓ move  Enter select  Esc clear/cancel  type to filter",
                ),
              ],
            );
          },
          invalidate(): void {
            refreshStyles();
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
            if (matchesKey(data, Key.escape)) {
              if (query !== "") {
                query = "";
                rebuild();
                tui.requestRender();
              } else {
                list.handleInput(data);
              }
              return;
            }
            const printable = decodePrintableInput(data);
            if (printable !== undefined) {
              query += printable;
              rebuild();
              tui.requestRender();
              return;
            }
            list.handleInput(data);
          },
          handleMouse(event: TuiMouseEvent) {
            const offset = options.mouseOffset ?? { x: 2, y: 2 };
            return list.handleMouse?.({
              ...event,
              x: event.x - offset.x,
              y: event.y - offset.y,
            });
          },
          dispose(): void {
            finish(undefined);
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
