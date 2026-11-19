import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import {
  formatSubagentWidget,
  formatTaskWidget,
  mountWidgetProviders,
  registerWidgetProvider,
} from "@hollowheap/tui/widget";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

const theme = {
  fg: (_token: string, value: string) => value,
  bg: (_token: string, value: string) => value,
  bold: (value: string) => value,
} as never;
const collapseHint =
  process.platform === "darwin" ? "Option+W then P" : "Alt+W then P";

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
  it("frames todos, tasks, and subagents rows and shows the hide chord in the border", () => {
    const { render } = harness();

    for (const key of ["todos", "tasks", "subagents"]) {
      const rows = render(key);
      expect(rows.length).toBeGreaterThan(2);
      expect(rows[0]?.startsWith("╭─")).toBe(true);
      expect(rows.at(-1)?.endsWith("╯")).toBe(true);
      expect(rows.some((row) => row.includes("│"))).toBe(true);
      expect(rows[0]).toContain(collapseHint);
      expect(rows[0]).toContain("hide");
    }
  });

  it("follows the configured border style", () => {
    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, borderStyle: "double" });
    const { render } = harness();
    const rows = render("todos");
    expect(rows[0]?.startsWith("╔═")).toBe(true);
    expect(rows.at(-1)?.endsWith("╝")).toBe(true);
    expect(rows[0]).toContain(collapseHint);
  });

  it("keeps the collapse chord working", () => {
    const { ctx, widgets, shortcut, terminal } = harness();

    expect(shortcut?.description).toContain("Then P to toggle sticky widgets");
    expect(terminal("p")).not.toMatchObject({ consume: true });
    shortcut.handler(ctx);
    expect(terminal("p")).toEqual({ consume: true });

    expect(widgets.size).toBe(0);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("todos", undefined);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("tasks", undefined);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("subagents", undefined);

    shortcut.handler(ctx);
    expect(terminal("P")).toEqual({ consume: true });
    expect(widgets.size).toBe(3);
  });
});
