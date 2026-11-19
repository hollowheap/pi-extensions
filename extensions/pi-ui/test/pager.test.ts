import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showMarkdownPager } from "../src/pager.js";

afterEach(() => {
  resetActiveTuiConfig();
});

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
        capturesViewportInput?: boolean;
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
    expect(component?.capturesViewportInput).toBe(true);
    const first = component?.render(60) ?? [];
    expect(first[0]).toContain("Task task-1");
    expect(first[0]).toContain("╭");
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

  it("rebuilds the Markdown style on config change and invalidate", async () => {
    const coloredTheme = {
      ...theme,
      fg: (token: string, text: string) =>
        `\x1b[${token === "accent" ? 36 : 34}m${text}\x1b[39m`,
    };
    const requestRender = vi.fn();
    let component:
      | {
          render(width: number): string[];
          invalidate(): void;
          dispose(): void;
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
              invalidate(): void;
              dispose(): void;
            },
          ) => {
            component = factory(
              { terminal: { rows: 12 }, requestRender },
              coloredTheme,
              {},
              vi.fn(),
            );
            return Promise.resolve();
          },
        ),
      },
    };

    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, colored: true });
    await showMarkdownPager(ctx as never, {
      title: "Report",
      markdown: "# Heading\n\nText with `code`",
    });
    if (!component) throw new Error("pager component was not captured");

    const colored = component.render(60).join("\n");
    expect(colored).toContain("\x1b[36mHeading");

    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, colored: false });
    expect(requestRender).toHaveBeenCalled();
    expect(component.render(60).join("\n")).not.toContain("\x1b[36mHeading");

    requestRender.mockClear();
    component.invalidate();
    expect(requestRender).toHaveBeenCalledTimes(1);
    component.dispose();
  });

  it("re-reads the live theme when invalidated", async () => {
    let live = {
      ...theme,
      fg: (_token: string, text: string) => `\x1b[31m${text}\x1b[39m`,
    };
    let component:
      | { render(width: number): string[]; invalidate(): void; dispose(): void }
      | undefined;
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        get theme() {
          return live;
        },
        custom: vi.fn(
          (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: () => void,
            ) => {
              render(width: number): string[];
              invalidate(): void;
              dispose(): void;
            },
          ) => {
            component = factory(
              { terminal: { rows: 12 }, requestRender: vi.fn() },
              theme,
              {},
              vi.fn(),
            );
            return Promise.resolve();
          },
        ),
      },
    };

    await showMarkdownPager(ctx as never, {
      title: "Report",
      markdown: "# Heading",
    });
    if (!component) throw new Error("pager component was not captured");
    expect(component.render(60).join("\n")).toContain("\x1b[31mHeading");

    live = {
      ...theme,
      fg: (_token: string, text: string) => `\x1b[32m${text}\x1b[39m`,
    };
    component.invalidate();
    expect(component.render(60).join("\n")).toContain("\x1b[32mHeading");
    component.dispose();
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
