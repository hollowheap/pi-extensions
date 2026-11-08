import { describe, expect, it, vi } from "vitest";
import { showMarkdownPager } from "./pager.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
};

function pagerContext() {
  const requestRender = vi.fn();
  const done = vi.fn();
  const notify = vi.fn();
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;

  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify,
      custom: vi.fn(
        async (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) => {
          component = factory(
            {
              terminal: { rows: 12 },
              requestRender,
            },
            theme,
            {},
            done,
          );
        },
      ),
    },
  };

  return { ctx, done, notify, requestRender, component: () => component };
}

describe("showMarkdownPager", () => {
  it("renders a viewport and scrolls through content", async () => {
    const env = pagerContext();
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
    await showMarkdownPager(env.ctx as never, {
      title: "Task task-1",
      markdown: lines.join("\n"),
    });

    const component = env.component();
    expect(component).toBeDefined();
    const first = component?.render(60) ?? [];
    expect(first[0]).toBe("Task task-1");
    expect(first.join("\n")).toContain("line 1");
    expect(first.join("\n")).toContain("1-7/40");

    component?.handleInput("\x1b[6~");
    const second = component?.render(60) ?? [];
    expect(env.requestRender).toHaveBeenCalled();
    expect(second.join("\n")).not.toBe(first.join("\n"));
    expect(second.join("\n")).toContain("8-14/40");

    component?.handleInput("\x1b");
    expect(env.done).toHaveBeenCalledTimes(1);
  });

  it("falls back to a notification without a TUI overlay", async () => {
    const notify = vi.fn();
    const ctx = {
      mode: "rpc",
      hasUI: true,
      ui: { notify },
    };
    await showMarkdownPager(ctx as never, {
      title: "Task task-1",
      markdown: "**output**",
      plainText: "output",
    });
    expect(notify).toHaveBeenCalledWith("output", "info");
  });

  it("resolves and releases the prompt lock when disposed without calling done", async () => {
    let component:
      | {
          render(width: number): string[];
          handleInput(data: string): void;
          dispose?: () => void;
        }
      | undefined;
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        custom: vi.fn(
          (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: () => void,
            ) => {
              render(width: number): string[];
              handleInput(data: string): void;
              dispose?: () => void;
            },
          ) =>
            new Promise<void>((resolve) => {
              component = factory(
                { terminal: { rows: 12 }, requestRender: vi.fn() },
                theme,
                {},
                resolve,
              );
            }),
        ),
      },
    };

    const first = showMarkdownPager(ctx as never, {
      title: "Task 1",
      markdown: "hello",
    });
    await vi.waitFor(() => expect(component).toBeDefined());
    component?.dispose?.();
    await expect(first).resolves.toBeUndefined();
  });
});
