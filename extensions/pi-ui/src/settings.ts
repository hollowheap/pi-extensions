import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { isPermissionError } from "@hollowheap/core/config";
import { errorMessage } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/tui/frame";
import { canOverlay, hostUi, notify, showDialog } from "./host.js";

export function settingsListTheme(
  theme: Theme,
  isColored: () => boolean = () => true,
): SettingsListTheme {
  const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
    isColored() ? theme.fg(token, text) : text;
  return {
    label: (text, selected) =>
      selected ? fg("accent", text) : fg("text", text),
    value: (text, selected) =>
      selected ? fg("accent", text) : fg("muted", text),
    description: (text) => fg("muted", text),
    get cursor() {
      return fg("accent", "› ");
    },
    hint: (text) => fg("dim", text),
  };
}

export interface SettingsDialogOptions {
  ctx: ExtensionContext;
  title: string;
  items: readonly SettingItem[];
  listHeight?: number;
  header?: (list: SettingsList) => string[];
  onChange: (id: string, value: string, list: SettingsList, tui: TUI) => void;
  onClose?: () => void;
  mouseOffsetY?: number;
  promptLock?: boolean;
  colored?: () => boolean;
}

export async function showSettingsDialog(
  options: SettingsDialogOptions,
): Promise<void> {
  const { ctx } = options;
  if (ctx.mode !== "tui" || typeof hostUi(ctx)?.custom !== "function") return;

  const mount = () =>
    showDialog<void>(
      ctx,
      (tui, theme, _keybindings, done) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          options.onClose?.();
          done();
        };
        const list = new SettingsList(
          [...options.items],
          options.listHeight ?? 8,
          settingsListTheme(theme, options.colored),
          (id, value) => {
            options.onChange(id, value, list, tui);
            tui.requestRender();
          },
          finish,
          { enableSearch: true },
        );

        return {
          render(width: number): string[] {
            const lines = [
              ...(options.header?.(list) ?? []),
              ...list.render(getFrameInnerWidth(width)),
            ];
            return boxFrame(lines, width, theme, options.title);
          },
          handleInput(data: string): void {
            list.handleInput(data);
          },
          handleMouse(event: TuiMouseEvent) {
            if (options.mouseOffsetY === undefined) return undefined;
            return list.handleMouse({
              ...event,
              x: event.x - 2,
              y: event.y - options.mouseOffsetY,
            });
          },
          invalidate(): void {
            list.invalidate();
          },
          dispose: finish,
        };
      },
      {
        overlay: true,
        overlayOptions: { width: "70%", maxHeight: "70%", margin: 1 },
      },
    );

  if (options.promptLock) await withPromptLock(mount);
  else await mount();
}

export interface SettingsCommandOptions {
  prefix: string;
  title: string;
  configPath: string;
  diagnostics?: readonly string[];
  open: () => Promise<boolean> | boolean;
  savedMessage?: string;
  nonTuiMessage?: string;
}

export type SettingsCommandContext = Pick<
  ExtensionContext,
  "ui" | "mode" | "hasUI"
>;

export function notifyDiagnostics(
  ctx:
    | (Parameters<typeof notify>[0] & Pick<ExtensionContext, "hasUI">)
    | undefined,
  prefix: string,
  diagnostics: readonly string[],
): void {
  if (!ctx?.hasUI) return;
  for (const message of diagnostics) {
    notify(
      ctx,
      `${prefix}: ${message}`,
      isPermissionError(message) ? "error" : "warning",
    );
  }
}

export async function runSettingsCommand(
  ctx: SettingsCommandContext,
  options: SettingsCommandOptions,
): Promise<boolean> {
  const diagnostics = options.diagnostics ?? [];
  const notifyUi = (message: string, level: Parameters<typeof notify>[2]) => {
    if (ctx.hasUI) notify(ctx, message, level);
  };

  notifyDiagnostics(ctx, options.prefix, diagnostics);
  if (!canOverlay(ctx)) {
    notifyUi(
      options.nonTuiMessage ??
        `${options.title} requires TUI mode; edit ${options.configPath}`,
      "info",
    );
    return false;
  }

  let saved = false;
  try {
    saved = (await options.open()) === true;
  } catch (error) {
    notifyUi(
      `${options.prefix}: failed to save settings: ${errorMessage(error)}`,
      "error",
    );
  }
  if (saved && options.savedMessage) {
    notifyUi(options.savedMessage, "info");
  }
  return saved;
}
