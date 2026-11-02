import { describe, expect, it, vi } from "vitest";
import { withCancellableProgress } from "./progress.js";

const theme = {
  fg: (_token: string, text: string) => text,
};

function progressContext() {
  const requestRender = vi.fn();
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;
  const ctx = {
    mode: "tui",
    hasUI: true,
    signal: undefined,
    ui: {
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (result: unknown) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise((resolve) => {
            component = factory({ requestRender }, theme, {}, (result) => {
              resolve(result);
            });
          }),
      ),
    },
  };

  return { ctx, component: () => component, requestRender };
}

describe("withCancellableProgress", () => {
  it("returns the operation value when it completes", async () => {
    const env = progressContext();
    const result = withCancellableProgress(
      env.ctx as never,
      "Working",
      async () => 42,
    );

    await expect(result).resolves.toEqual({
      status: "completed",
      value: 42,
    });
  });

  it("aborts the operation when Escape is pressed", async () => {
    const env = progressContext();
    let operationSignal: AbortSignal | undefined;
    const result = withCancellableProgress(
      env.ctx as never,
      "Working",
      (signal) => {
        operationSignal = signal;
        return new Promise<number>(() => {});
      },
    );

    await vi.waitFor(() => expect(env.component()).toBeDefined());
    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toEqual({ status: "cancelled" });
    expect(operationSignal?.aborted).toBe(true);
  });

  it("does not surface an abort rejection after cancellation", async () => {
    const env = progressContext();
    const result = withCancellableProgress(
      env.ctx as never,
      "Working",
      (signal) =>
        new Promise<number>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );

    await vi.waitFor(() => expect(env.component()).toBeDefined());
    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toEqual({ status: "cancelled" });
  });

  it("uses the parent signal without a TUI", async () => {
    const controller = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const result = await withCancellableProgress(
      { mode: "rpc", hasUI: true, signal: controller.signal, ui: {} } as never,
      "Working",
      async (signal) => {
        operationSignal = signal;
        return "done";
      },
    );

    expect(result).toEqual({ status: "completed", value: "done" });
    expect(operationSignal).toBe(controller.signal);
  });
});
