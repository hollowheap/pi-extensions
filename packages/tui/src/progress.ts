import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  CancellableLoader,
  Key,
  type LoaderIndicatorOptions,
  Text,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { BorderStyle } from "@hollowheap/core/border";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import type { OverlaySurfaceMode } from "@hollowheap/core/tui-config";
import { roundedFrame } from "./frame.js";
import { createWorkingIndicator } from "./spinner.js";
import { getActiveTuiConfig, subscribeActiveTuiConfig } from "./state.js";

export type CancellableProgressResult<T> =
  | { status: "completed"; value: T }
  | { status: "cancelled" };

export interface CancellableProgressOptions {
  borderStyle?: BorderStyle;
  overlaySurface?: OverlaySurfaceMode;
  indicator?: LoaderIndicatorOptions;
}

function progressComponent(
  tui: ConstructorParameters<typeof CancellableLoader>[0],
  getTheme: () => Theme,
  message: string,
  onAbort: () => void,
  options?: CancellableProgressOptions,
) {
  const buildIndicator = (): LoaderIndicatorOptions | undefined => {
    const active = getActiveTuiConfig();
    return (
      options?.indicator ??
      createWorkingIndicator(
        active.loadingIndicator,
        getTheme(),
        active.colored,
      )
    );
  };
  const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
    getActiveTuiConfig().colored ? getTheme().fg(token, text) : text;
  const loader = new CancellableLoader(
    tui,
    (text) => fg("accent", text),
    (text) => fg("muted", text),
    message,
    buildIndicator(),
  );
  let hint = new Text(fg("dim", "Esc to cancel"), 1, 0);
  loader.onAbort = onAbort;
  return {
    loader,
    render(width: number): string[] {
      const active = getActiveTuiConfig();
      const borderStyle = options?.borderStyle ?? active.borderStyle;
      const overlaySurface = options?.overlaySurface ?? active.overlaySurface;
      const innerWidth =
        borderStyle === "none" ? Math.max(1, width) : Math.max(1, width - 4);
      return roundedFrame(
        [...loader.render(innerWidth), ...hint.render(innerWidth)],
        width,
        getTheme(),
        undefined,
        { borderStyle, overlaySurface },
      );
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape)) {
        onAbort();
        return;
      }
      loader.handleInput(data);
    },
    invalidate(): void {
      loader.setIndicator(buildIndicator());
      hint = new Text(fg("dim", "Esc to cancel"), 1, 0);
      loader.invalidate();
    },
    dispose(): void {
      loader.dispose();
    },
  };
}

/**
 * Show a cancellable loader while an operation runs. Escape aborts the
 * operation and resolves with a cancelled result.
 */
export async function withCancellableProgress<T>(
  ctx: ExtensionContext,
  message: string,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  options?: CancellableProgressOptions,
): Promise<CancellableProgressResult<T>> {
  const parentSignal = signal ?? ctx.signal;
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return {
      status: "completed",
      value: await operation(parentSignal ?? new AbortController().signal),
    };
  }

  let failure: unknown;
  return withPromptLock(() =>
    ctx.ui.custom<CancellableProgressResult<T>>(
      (tui, theme, _keybindings, done) => {
        const controller = new AbortController();
        let settled = false;
        const getTheme = (): Theme =>
          (ctx.ui as { theme?: Theme } | undefined)?.theme ?? theme;
        const state: {
          component?: ReturnType<typeof progressComponent>;
        } = {};
        let unsubscribe = (): void => {};

        const cleanup = (): void => {
          parentSignal?.removeEventListener("abort", onParentAbort);
        };
        const finish = (result: CancellableProgressResult<T>): void => {
          if (settled) return;
          settled = true;
          state.component?.loader.stop();
          cleanup();
          unsubscribe();
          done(result);
        };
        const cancel = (): void => {
          controller.abort();
          finish({ status: "cancelled" });
        };
        const onParentAbort = (): void => cancel();
        const refreshStyles = (): void => {
          if (settled) return;
          state.component?.invalidate();
          tui.requestRender();
        };
        unsubscribe = subscribeActiveTuiConfig(refreshStyles);
        state.component = progressComponent(
          tui,
          getTheme,
          message,
          cancel,
          options,
        );
        if (parentSignal?.aborted) {
          cancel();
        } else {
          parentSignal?.addEventListener("abort", onParentAbort, {
            once: true,
          });
        }

        void operation(controller.signal).then(
          (value) => finish({ status: "completed", value }),
          (error: unknown) => {
            if (settled) return;
            failure = error;
            finish({ status: "cancelled" });
          },
        );

        return {
          render: (width: number) => state.component?.render(width) ?? [],
          handleInput: (data: string) => state.component?.handleInput(data),
          invalidate: () => refreshStyles(),
          dispose: () => {
            if (!settled) cancel();
            cleanup();
            unsubscribe();
            state.component?.dispose();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: "60%",
          maxHeight: 6,
          margin: 1,
        },
      },
    ),
  ).then((result) => {
    if (failure !== undefined) throw failure;
    return result;
  });
}
