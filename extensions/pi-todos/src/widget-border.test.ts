import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const theme = {
  fg: (_token: string, value: string) => value,
  bg: (_token: string, value: string) => value,
  bold: (value: string) => value,
} as never;

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
  handlers.get("session_start")?.({}, ctx);
  eventHandlers.get("subagents:state")?.([{ id: "sub-1", state: "running" }]);
  eventHandlers.get("tasks:state")?.([{ id: "task-1", status: "running" }]);
  return {
    ctx,
    widgets,
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
      expect(rows[0]).toContain("Ctrl+X");
      expect(rows[0]).toContain("hide");
    }
  });

  it("follows the configured border style", () => {
    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, borderStyle: "double" });
    const { render } = harness();
    const rows = render("todos");
    expect(rows[0]?.startsWith("╔═")).toBe(true);
    expect(rows.at(-1)?.endsWith("╝")).toBe(true);
    expect(rows[0]).toContain("Ctrl+X");
  });

  it("keeps the collapse chord working", () => {
    const { ctx, widgets, terminal } = harness();

    terminal("\x18");
    terminal("p");

    expect(widgets.size).toBe(0);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("todos", undefined);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("tasks", undefined);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith("subagents", undefined);
  });
});
