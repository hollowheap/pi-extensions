import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  CancellableLoader,
  Key,
  Text,
  matchesKey,
} from "@earendil-works/pi-tui";
import { withPromptLock } from "@hollowheap/core";

export type CancellableProgressResult<T> =
  | { status: "completed"; value: T }
  | { status: "cancelled" };

function progressComponent(
  tui: ConstructorParameters<typeof CancellableLoader>[0],
  theme: Theme,
  message: string,
  onAbort: () => void,
) {
  const loader = new CancellableLoader(
    tui,
    (text) => theme.fg("accent", text),
    (text) => theme.fg("muted", text),
    message,
  );
  const hint = new Text(theme.fg("dim", "Esc to cancel"), 1, 0);
  loader.onAbort = onAbort;
  return {
    loader,
    render(width: number): string[] {
      return [...loader.render(width), ...hint.render(width)];
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.escape)) {
        onAbort();
        return;
      }
      loader.handleInput(data);
    },
    invalidate(): void {
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
        const state: {
          component?: ReturnType<typeof progressComponent>;
        } = {};

        const cleanup = (): void => {
          parentSignal?.removeEventListener("abort", onParentAbort);
        };
        const finish = (result: CancellableProgressResult<T>): void => {
          if (settled) return;
          settled = true;
          state.component?.loader.stop();
          cleanup();
          done(result);
        };
        const cancel = (): void => {
          controller.abort();
          finish({ status: "cancelled" });
        };
        const onParentAbort = (): void => cancel();
        state.component = progressComponent(tui, theme, message, cancel);
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
          invalidate: () => state.component?.invalidate(),
          dispose: () => {
            cleanup();
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
