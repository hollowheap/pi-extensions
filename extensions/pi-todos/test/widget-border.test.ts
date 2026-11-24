import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { resetActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/ui/state";
import {
  COLLAPSED_WIDGET_KEY,
  formatSubagentWidget,
  formatTaskWidget,
  mountWidgetProviders,
  registerWidgetProvider,
} from "@hollowheap/ui/widget";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

const theme = {
  fg: (_token: string, value: string) => value,
  bg: (_token: string, value: string) => value,
  bold: (value: string) => value,
} as never;
const modifier = process.platform === "darwin" ? "Option+W" : "Alt+W";
const collapseHint = (key: string) => `${modifier} then ${key}`;

type WidgetFactory = () => { render: (width: number) => string[] };

function harness() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const eventHandlers = new Map<string, (data: unknown) => void>();
  const widgets = new Map<string, WidgetFactory>();
  let terminalHandler:
    | ((data: string) => { consume?: boolean } | undefined)
    | undefined;
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(event, handler);
        return () => {};
      },
    ),
    events: {
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        eventHandlers.set(event, handler);
      }),
      emit: vi.fn(),
    },
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    appendEntry: vi.fn(),
    registerTool: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  };
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: {
      theme,
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn((key: string, factory: WidgetFactory | undefined) => {
        if (factory) widgets.set(key, factory);
        else widgets.delete(key);
      }),
      custom: vi.fn(),
      onTerminalInput: vi.fn(
        (handler: (data: string) => { consume?: boolean } | undefined) => {
          terminalHandler = handler;
          return vi.fn();
        },
      ),
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "custom",
          customType: "hollowheap.todos",
          data: {
            todos: [{ id: 1, text: "Ship widget borders", done: false }],
            nextId: 2,
          },
        },
      ],
    },
  };
  extension(pi as never);
  registerWidgetProvider({
    name: "subagents",
    label: "Subagents",
    render: (width) =>
      formatSubagentWidget([{ id: "sub-1", state: "running" }], {
        width: width >= 80 ? width : 0,
      }),
  });
  registerWidgetProvider({
    name: "tasks",
    label: "Tasks",
    render: (width) =>
      formatTaskWidget([{ id: "task-1", status: "running" }], {
        width: width >= 80 ? width : 0,
      }),
  });
  handlers.get("session_start")?.({}, ctx);
  mountWidgetProviders(ctx as never);
  return {
    ctx,
    widgets,
    shortcut: pi.registerShortcut.mock.calls.find(
      ([key]) => key === "alt+w",
    )?.[1],
    render: (key: string) => widgets.get(key)?.().render(80) ?? [],
    terminal: (data: string) => terminalHandler?.(data),
  };
}

afterEach(() => {
  resetActiveTuiConfig();
});

describe("sticky widget frames", () => {
  it("frames todos, tasks, and subagents rows and shows each hide chord in its border", () => {
    const { render } = harness();

    for (const [name, chord] of [
      ["todos", "T"],
      ["tasks", "B"],
      ["subagents", "S"],
    ] as const) {
      const rows = render(name);
      expect(rows.length).toBeGreaterThan(2);
      expect(rows[0]?.startsWith("╭─")).toBe(true);
      expect(rows.at(-1)?.endsWith("╯")).toBe(true);
      expect(rows.some((row) => row.includes("│"))).toBe(true);
      expect(rows[0]).toContain(collapseHint(chord));
      expect(rows[0]).toContain("hide");
    }
  });

  it("follows the configured border style", () => {
    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, borderStyle: "double" });
    const { render } = harness();
    const rows = render("todos");
    expect(rows[0]?.startsWith("╔═")).toBe(true);
    expect(rows.at(-1)?.endsWith("╝")).toBe(true);
    expect(rows[0]).toContain(collapseHint("T"));
  });

  it("toggles each widget with its own chord and keeps P for all", () => {
    const { ctx, widgets, shortcut, terminal } = harness();
    const activeCount = () =>
      [...widgets.keys()].filter((key) => key !== COLLAPSED_WIDGET_KEY).length;

    expect(shortcut?.description).toContain(
      "Then P (all), T todos, B tasks, or S subagents",
    );
    expect(terminal("t")).not.toMatchObject({ consume: true });

    for (const [key, name] of [
      ["t", "todos"],
      ["b", "tasks"],
      ["s", "subagents"],
    ] as const) {
      shortcut.handler(ctx);
      expect(terminal(key)).toEqual({ consume: true });
      expect(widgets.has(name)).toBe(false);
      expect(activeCount()).toBe(2);
      expect(widgets.has(COLLAPSED_WIDGET_KEY)).toBe(true);

      shortcut.handler(ctx);
      expect(terminal(key.toUpperCase())).toEqual({ consume: true });
      expect(widgets.has(name)).toBe(true);
      expect(activeCount()).toBe(3);
    }

    shortcut.handler(ctx);
    expect(terminal("x")).not.toMatchObject({ consume: true });
    shortcut.handler(ctx);
    expect(terminal("p")).toEqual({ consume: true });

    expect(activeCount()).toBe(0);
    expect(widgets.has(COLLAPSED_WIDGET_KEY)).toBe(true);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("todos", undefined);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("tasks", undefined);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("subagents", undefined);

    shortcut.handler(ctx);
    expect(terminal("P")).toEqual({ consume: true });
    expect(activeCount()).toBe(3);
    expect(widgets.has(COLLAPSED_WIDGET_KEY)).toBe(false);
  });
});
