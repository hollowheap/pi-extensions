import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { isPermissionError } from "@hollowheap/core/config";
import { errorMessage } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import {
  type FrameOptions,
  boxFrame,
  getFrameInnerWidth,
} from "@hollowheap/tui/frame";
import { TabbedContent } from "@hollowheap/tui/tabs";
import { canOverlay, notify, showDialog } from "./host.js";

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
  header?: (list: SettingsList, theme: Theme) => string[];
  onChange: (id: string, value: string, list: SettingsList, tui: TUI) => void;
  onClose?: () => void;
  mouseOffsetY?: number;
  promptLock?: boolean;
  colored?: () => boolean;
}

function frameOffsetX(width: number, frameOpts?: FrameOptions): number {
  const innerWidth = getFrameInnerWidth(
    width,
    frameOpts?.borderStyle,
    frameOpts?.paddingX,
    frameOpts?.overlaySurface,
    frameOpts?.colored,
  );
  return Math.max(0, Math.floor((Math.max(4, width) - innerWidth) / 2));
}

async function mountSettingsOverlay(options: {
  ctx: ExtensionContext;
  promptLock?: boolean;
  onClose?: () => void;
  maxHeight: `${number}%`;
  build: (
    tui: TUI,
    theme: Theme,
    finish: () => void,
  ) => {
    render: (width: number) => string[];
    handleInput: (data: string) => void;
    handleMouse?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
    invalidate: () => void;
  };
}): Promise<void> {
  if (!canOverlay(options.ctx)) return;
  const mount = () =>
    showDialog<void>(
      options.ctx,
      (tui, theme, _keybindings, done) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          options.onClose?.();
          done();
        };
        const content = options.build(tui, theme, finish);
        return {
          ...content,
          dispose: finish,
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: "70%",
          maxHeight: options.maxHeight,
          margin: 1,
        },
      },
    );

  if (options.promptLock) await withPromptLock(mount);
  else await mount();
}

export async function showSettingsDialog(
  options: SettingsDialogOptions,
): Promise<void> {
  await mountSettingsOverlay({
    ctx: options.ctx,
    promptLock: options.promptLock,
    onClose: options.onClose,
    maxHeight: "70%",
    build: (tui, theme, finish) => {
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
      let offsetX = 2;

      return {
        render(width: number): string[] {
          offsetX = frameOffsetX(width);
          const lines = [
            ...(options.header?.(list, theme) ?? []),
            ...list.render(getFrameInnerWidth(width)),
          ];
          return boxFrame(lines, width, theme, options.title);
        },
        handleInput(data: string): void {
          list.handleInput(data);
        },
        handleMouse(event: TuiMouseEvent) {
          if (options.mouseOffsetY === undefined) return undefined;
          const localY = event.y - options.mouseOffsetY;
          if (localY < 0) return undefined;
          return list.handleMouse({
            ...event,
            x: event.x - offsetX,
            y: localY,
          });
        },
        invalidate(): void {
          list.invalidate();
        },
      };
    },
  });
}

export interface SettingsTab {
  label: string;
  items: readonly SettingItem[];
}

export interface TabbedSettingsDialogOptions {
  ctx: ExtensionContext;
  title: string;
  tabs: readonly SettingsTab[];
  listHeight?: number;
  onChange: (id: string, value: string, list: SettingsList, tui: TUI) => void;
  onClose?: () => void;
  mouseOffsetY?: number;
  promptLock?: boolean;
  colored?: () => boolean;
  frameOptions?: () => FrameOptions | undefined;
}

export async function showTabbedSettingsDialog(
  options: TabbedSettingsDialogOptions,
): Promise<void> {
  await mountSettingsOverlay({
    ctx: options.ctx,
    promptLock: options.promptLock,
    onClose: options.onClose,
    maxHeight: "75%",
    build: (tui, theme, finish) => {
      const isColored = options.colored ?? (() => true);
      const listTheme = settingsListTheme(theme, isColored);
      const tabLists = options.tabs.map(
        (tab) =>
          new SettingsList(
            [...tab.items],
            options.listHeight ?? 6,
            listTheme,
            (id, value) => {
              options.onChange(id, value, tabLists[tabs.activeIndex], tui);
              tui.requestRender();
            },
            finish,
            { enableSearch: true },
          ),
      );
      const tabs = new TabbedContent(
        options.tabs.map((tab, index) => ({
          label: tab.label,
          content: tabLists[index],
        })),
        (label, active) =>
          isColored() ? theme.fg(active ? "accent" : "muted", label) : label,
      );
      const offsetY = options.mouseOffsetY ?? (tabLists.length > 1 ? 4 : 1);
      let offsetX = 2;

      return {
        render(width: number): string[] {
          const frameOpts = options.frameOptions?.();
          offsetX = frameOffsetX(width, frameOpts);
          const innerWidth = getFrameInnerWidth(
            width,
            frameOpts?.borderStyle,
            frameOpts?.paddingX,
            frameOpts?.overlaySurface,
            frameOpts?.colored,
          );
          return boxFrame(
            tabs.render(innerWidth),
            width,
            theme,
            options.title,
            frameOpts,
          );
        },
        handleInput(data: string): void {
          tabs.handleInput(data);
        },
        handleMouse(event: TuiMouseEvent) {
          if (event.y < offsetY) return undefined;
          const activeList = tabLists[tabs.activeIndex];
          if (!activeList) return undefined;
          return activeList.handleMouse({
            ...event,
            x: event.x - offsetX,
            y: event.y - offsetY,
          });
        },
        invalidate(): void {
          tabs.invalidate();
        },
      };
    },
  });
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
