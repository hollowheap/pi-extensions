import type {
  ExtensionContext,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  Input,
  Key,
  SelectList,
  type TUI,
  Text,
  matchesKey,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { scopedAbortSignal, watchAbort } from "@hollowheap/runtime/abort";
import {
  type FrameOptions,
  boxFrame,
  getFrameInnerWidth,
} from "@hollowheap/ui/frame";
import { safeFg } from "@hollowheap/ui/theme";
import { selectListTheme } from "./picker.js";

type PromptContext = Pick<ExtensionContext, "ui" | "mode" | "signal">;
type OverlayContext = Pick<ExtensionContext, "ui" | "mode">;

type FocusedComponent = Component & { dispose?(): void };
type DialogFactory<T> = (
  tui: TUI,
  theme: Theme,
  keys: KeybindingsManager,
  done: (result: T) => void,
) => FocusedComponent | Promise<FocusedComponent>;
type DialogOptions = NonNullable<Parameters<ExtensionUIContext["custom"]>[1]>;
type PromptOptions = ExtensionUIDialogOptions & {
  overlay?: boolean;
};

/** Host facilities for chrome such as footers, editor configuration, and themes. */
export function hostUi<T>(ctx: { ui: T }): T;
export function hostUi<T>(ctx: { ui?: T } | undefined): T | undefined;
export function hostUi<T>(ctx: { ui?: T } | undefined): T | undefined {
  return ctx?.ui;
}

/** Track a live host theme so overlays follow theme changes. */
export function overlayTheme(
  ctx: { ui?: { theme?: Theme } } | undefined,
  fallback: Theme,
): () => Theme {
  return () => hostUi(ctx)?.theme ?? fallback;
}

/** One-shot completion state shared by overlay components. */
export function settledGuard(): {
  isSettled(): boolean;
  settle(): boolean;
} {
  let settled = false;
  return {
    isSettled: () => settled,
    settle: () => {
      if (settled) return false;
      settled = true;
      return true;
    },
  };
}

/** Render overlay content inside the shared host frame. */
export function frameOverlay(
  width: number,
  theme: Theme,
  title: string | undefined,
  content: (innerWidth: number) => readonly string[],
  options?: FrameOptions,
): string[] {
  const frameOptions: FrameOptions = {
    paddingX: 1,
    marginX: 0,
    ...options,
  };
  const innerWidth = getFrameInnerWidth(
    width,
    frameOptions.borderStyle,
    frameOptions.paddingX,
    frameOptions.overlaySurface,
    frameOptions.colored,
    frameOptions.marginX,
  );
  return boxFrame(content(innerWidth), width, theme, title, frameOptions);
}

/** Keep the host responsible for notifications, with terminal-safe text. */
export function notify(
  ctx: { ui?: Partial<Pick<ExtensionUIContext, "notify">> } | undefined,
  ...args: Parameters<ExtensionUIContext["notify"]>
): void {
  args[0] = sanitizeTerminalText(args[0], { allowSgr: true });
  hostUi(ctx)?.notify?.(...args);
}

/** Mount an extension-owned dialog through the host's focus and overlay lifecycle. */
export async function showDialog<T>(
  ctx: Pick<ExtensionContext, "ui">,
  ...args: [factory: DialogFactory<T>, options?: DialogOptions]
): Promise<T> {
  return hostUi(ctx).custom<T>(...args);
}

export function canOverlay(ctx: OverlayContext): boolean {
  return ctx.mode === "tui" && typeof hostUi(ctx)?.custom === "function";
}

export interface InfoPopupOptions {
  title: string;
  lines?: readonly string[] | ((theme: Theme) => readonly string[]);
  render?: (width: number) => string[];
  closeKeys?: readonly string[];
}

/** Mount a dismissable informational overlay with the shared frame and keys. */
export async function showInfoPopup(
  ctx: OverlayContext,
  options: InfoPopupOptions,
): Promise<void> {
  if (!canOverlay(ctx)) return;

  await showDialog<void>(
    ctx,
    (_tui, theme, _keybindings, done) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        done();
      };
      const rawLines =
        typeof options.lines === "function"
          ? options.lines(theme)
          : (options.lines ?? []);
      const body = (width: number): string[] =>
        options.render?.(width) ??
        rawLines.map((line) => sanitizeTerminalText(line, { allowSgr: true }));

      return {
        render(width: number): string[] {
          return frameOverlay(
            width,
            theme,
            sanitizeTerminalText(options.title),
            body,
          );
        },
        invalidate(): void {},
        handleInput(data: string): void {
          if (
            matchesKey(data, Key.escape) ||
            matchesKey(data, Key.enter) ||
            matchesKey(data, Key.space) ||
            matchesKey(data, Key.ctrl("c")) ||
            options.closeKeys?.includes(data)
          ) {
            finish();
          }
        },
        dispose: finish,
      };
    },
    {
      overlay: true,
      overlayOptions: { width: "70%", maxHeight: "75%", margin: 1 },
    },
  );
}

/** Wrap text to the frame interior for informational overlays. */
export function infoPopupText(lines: readonly string[]) {
  return (width: number): string[] =>
    new Text(lines.join("\n"), 0, 0).render(width);
}

type PromptComponent = Component & { focused?: boolean };

function prompt<T>(
  ctx: PromptContext,
  title: string,
  create: (
    tui: TUI,
    theme: Theme,
    finish: (value: T) => void,
  ) => PromptComponent,
  options?: PromptOptions,
  description?: string,
): Promise<T | undefined> {
  const signal = options?.signal ?? ctx.signal;
  if (signal?.aborted) return Promise.resolve(undefined);

  return showDialog<T | undefined>(
    ctx,
    (tui, theme, _keys, done) => {
      const abort = scopedAbortSignal({ signal, timeoutMs: options?.timeout });
      const guard = settledGuard();
      let stopWatching: () => void = () => {};
      const finish = (value: T | undefined) => {
        if (!guard.settle()) return;
        stopWatching();
        abort.stop();
        done(value);
      };
      const component = create(tui, theme, finish);
      stopWatching = watchAbort(abort.signal, () => finish(undefined));
      return {
        get focused() {
          return component.focused ?? false;
        },
        set focused(focused) {
          component.focused = focused;
        },
        render(width) {
          return frameOverlay(
            width,
            theme,
            sanitizeTerminalText(title),
            (inner) => {
              const body = component.render(inner);
              if (description)
                body.unshift(...sanitizeTerminalText(description).split("\n"));
              return body;
            },
          );
        },
        invalidate: () => component.invalidate(),
        handleInput(data) {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            finish(undefined);
          } else {
            component.handleInput?.(data);
            tui.requestRender();
          }
        },
        dispose: () => finish(undefined),
      };
    },
    {
      overlay: options?.overlay ?? true,
      ...(options?.overlay === false
        ? {}
        : {
            overlayOptions: {
              width: "70%",
              maxHeight: "75%",
              margin: 1,
            },
          }),
    },
  );
}

function selectOverlay(
  ctx: PromptContext,
  title: string,
  options: string[],
  dialogOptions?: PromptOptions,
  description?: string,
): Promise<string | undefined> {
  return prompt<string>(
    ctx,
    title,
    (_tui, theme, finish) => {
      const list = new SelectList(
        options.map((value) => ({ value, label: sanitizeTerminalText(value) })),
        Math.max(1, Math.min(8, options.length)),
        selectListTheme(theme, true, "dim"),
      );
      list.onSelect = (item) => finish(item.value);
      return list;
    },
    dialogOptions,
    description,
  );
}

export function selectDialog(
  ctx: PromptContext,
  ...args: [title: string, choices: string[], options?: PromptOptions]
) {
  return canOverlay(ctx)
    ? selectOverlay(ctx, ...args)
    : hostUi(ctx).select(...args);
}

export async function confirmDialog(
  ctx: PromptContext,
  ...args: Parameters<ExtensionUIContext["confirm"]>
) {
  if (!canOverlay(ctx)) return hostUi(ctx).confirm(...args);
  const [title, message, options] = args;
  return (
    (await selectOverlay(ctx, title, ["No", "Yes"], options, message)) === "Yes"
  );
}

export function inputDialog(
  ctx: PromptContext,
  ...args: Parameters<ExtensionUIContext["input"]>
) {
  if (!canOverlay(ctx)) return hostUi(ctx).input(...args);
  const [title, placeholder, options] = args;
  return prompt<string>(
    ctx,
    title,
    (_tui, _theme, finish) => {
      const input = new Input({
        placeholder: placeholder && sanitizeTerminalText(placeholder),
      });
      input.onSubmit = finish;
      return input;
    },
    options,
  );
}

export function editDialog(
  ctx: PromptContext,
  ...args: Parameters<ExtensionUIContext["editor"]>
) {
  if (!canOverlay(ctx)) return hostUi(ctx).editor(...args);
  const [title, prefill] = args;
  return prompt<string>(ctx, title, (tui, theme, finish) => {
    const fg = (text: string) => safeFg(theme, "border", text);
    const editor = new Editor(tui, {
      borderColor: fg,
      selectList: {
        selectedPrefix: fg,
        selectedText: fg,
        description: fg,
        scrollInfo: fg,
        noMatch: fg,
      },
    });
    if (prefill !== undefined) editor.setText(prefill);
    editor.onSubmit = finish;
    return editor;
  });
}
