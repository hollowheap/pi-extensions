import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type TuiMouseEvent,
  decodeKittyPrintable,
  fuzzyFilter,
  matchesKey,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/ui/frame";
import {
  getActiveTuiConfig,
  subscribeActiveTuiConfig,
} from "@hollowheap/ui/state";
import { canOverlay, hostUi, showDialog } from "./host.js";

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

function selectTheme(theme: Theme, colored: boolean): SelectListTheme {
  const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
    colored ? theme.fg(token, text) : text;
  return {
    selectedPrefix: (text) => fg("accent", text),
    selectedText: (text) => fg("accent", text),
    description: (text) => fg("muted", text),
    scrollInfo: (text) => fg("muted", text),
    noMatch: (text) => fg("muted", text),
  };
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const MODIFY_OTHER_KEYS_PREFIX = "\x1b[27;";
const MODIFY_OTHER_KEYS_ARGS = /^\d+;\d+$/;
const MODIFIER_SHIFT = 1;
const LOCK_MASK = 64 + 128;

function decodeModifyOtherKeysPrintable(data: string): string | undefined {
  if (!data.startsWith(MODIFY_OTHER_KEYS_PREFIX) || !data.endsWith("~")) {
    return undefined;
  }
  const args = data.slice(MODIFY_OTHER_KEYS_PREFIX.length, -1);
  if (!MODIFY_OTHER_KEYS_ARGS.test(args)) return undefined;
  const [modifierArg, codepointArg] = args.split(";");
  const modifier = Number.parseInt(modifierArg ?? "", 10) - 1;
  if (
    !Number.isFinite(modifier) ||
    (modifier & ~LOCK_MASK & ~MODIFIER_SHIFT) !== 0
  ) {
    return undefined;
  }
  const codepoint = Number.parseInt(codepointArg ?? "", 10);
  if (!Number.isFinite(codepoint) || codepoint < 32) return undefined;
  try {
    return String.fromCodePoint(codepoint);
  } catch {
    return undefined;
  }
}

function printablePayload(data: string): string | undefined {
  let payload: string;
  if (data.startsWith(PASTE_START)) {
    const end = data.indexOf(PASTE_END, PASTE_START.length);
    if (end === -1) return undefined;
    payload = data.slice(PASTE_START.length, end);
  } else {
    const kitty = decodeKittyPrintable(data);
    if (kitty !== undefined) {
      payload = kitty;
    } else {
      const other = decodeModifyOtherKeysPrintable(data);
      if (other !== undefined) {
        payload = other;
      } else if (data.length === 1) {
        payload = data;
      } else {
        return undefined;
      }
    }
  }
  const printable = [...payload]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("");
  return printable === "" ? undefined : printable;
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
        const getTheme = (): Theme => hostUi(ctx)?.theme ?? theme;
        let query = "";
        let settled = false;
        let selected: FuzzyPickerItem | undefined;
        let list: SelectList;
        let unsubscribe = (): void => {};
        let initialApplied = false;

        const finish = (value: string | undefined): void => {
          if (settled) return;
          settled = true;
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
            selectTheme(getTheme(), getActiveTuiConfig().colored),
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

        const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
          getActiveTuiConfig().colored ? getTheme().fg(token, text) : text;

        const preview = (): string[] => {
          if (!selected) {
            return [fg("muted", options.emptyText ?? "No matches")];
          }
          if (selected.preview && selected.preview.length > 0) {
            return selected.preview.map((line, index) =>
              index === 0
                ? fg("accent", getTheme().bold(line))
                : fg("muted", line),
            );
          }
          return selected.description
            ? [fg("muted", selected.description)]
            : [];
        };

        const refreshStyles = (): void => {
          if (settled) return;
          rebuild();
          tui.requestRender();
        };
        unsubscribe = subscribeActiveTuiConfig(refreshStyles);
        rebuild();
        return {
          render(width: number): string[] {
            const innerWidth = getFrameInnerWidth(width);
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
            const lines = [
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
            ];
            return boxFrame(lines, width, getTheme(), options.title);
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
            const printable = printablePayload(data);
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
