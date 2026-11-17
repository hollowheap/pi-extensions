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
import { roundedFrame } from "./frame.js";
import { getActiveTuiConfig, subscribeActiveTuiConfig } from "./state.js";

export interface FuzzyPickerItem extends SelectItem {
  preview?: string[];
}

export interface FuzzyPickerOptions {
  title: string;
  items: readonly FuzzyPickerItem[];
  emptyText?: string;
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
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return undefined;
  }

  const allItems = [...options.items];
  return withPromptLock(() =>
    ctx.ui.custom<string | undefined>(
      (tui, theme, _keybindings, done) => {
        const getTheme = (): Theme =>
          (ctx.ui as { theme?: Theme } | undefined)?.theme ?? theme;
        let query = "";
        let settled = false;
        let selected: FuzzyPickerItem | undefined;
        let list: SelectList;
        let unsubscribe = (): void => {};

        const finish = (value: string | undefined): void => {
          if (settled) return;
          settled = true;
          unsubscribe();
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
            selectTheme(getTheme(), getActiveTuiConfig().colored),
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
            const innerWidth = Math.max(1, width - 4);
            const lines = [
              fg(
                "muted",
                query === "" ? "Filter: (type to search)" : `Filter: ${query}`,
              ),
              ...list.render(innerWidth),
              "",
              ...preview(),
              "",
              fg(
                "dim",
                "↑↓ move  Enter select  Esc clear/cancel  type to filter",
              ),
            ];
            return roundedFrame(lines, width, getTheme(), options.title);
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
