import {
  formatSubagentWidget,
  formatTaskWidget,
  mountWidgetProviders,
  registerWidgetProvider,
} from "@hollowheap/ui/widget";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

function createMockPi() {
  return {
    on: vi.fn((_event: string, _handler: unknown) => () => {}),
    events: {
      on: vi.fn((_event: string, _handler: unknown) => {}),
      emit: vi.fn(),
    },
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  };
}

function widgetCommand(pi: ReturnType<typeof createMockPi>) {
  const call = pi.registerCommand.mock.calls.find(
    ([name]) => name === "widget",
  );
  return call?.[1] as {
    handler: (args: string, ctx: unknown) => Promise<void>;
    getArgumentCompletions: (prefix: string) => Array<{ value: string }> | null;
  };
}

function uiCtx() {
  return { hasUI: true, ui: { notify: vi.fn() } };
}

function widgetCtx() {
  return {
    hasUI: true,
    theme: {},
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: vi.fn(),
      setWidget: vi.fn(),
      onTerminalInput: vi.fn(() => () => {}),
    },
  };
}

function eventHandler(
  pi: ReturnType<typeof createMockPi>,
  name: string,
): ((event: unknown, ctx: unknown) => Promise<void> | void) | undefined {
  return pi.on.mock.calls.find(([event]) => event === name)?.[1] as
    | ((event: unknown, ctx: unknown) => Promise<void> | void)
    | undefined;
}

describe("widget command surface", () => {
  it("registers a widget command", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(names).toContain("widget");
  });

  it("widget command exposes per-widget toggles", () => {
    const pi = createMockPi();
    extension(pi as never);

    const call = pi.registerCommand.mock.calls.find(
      ([name]) => name === "widget",
    );
    const completion = (
      call?.[1] as
        | {
            getArgumentCompletions?: (
              prefix: string,
            ) => Array<{ value: string }> | null;
          }
        | undefined
    )?.getArgumentCompletions?.("");
    expect(completion ?? []).not.toHaveLength(0);
  });

  it("a bare widget command reports usage instead of toggling", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = uiCtx();

    await widgetCommand(pi).handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /widget toggle [todos|tasks|subagents|all]",
      "info",
    );
  });

  it("an unsupported widget target is refused with an error", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = uiCtx();

    await widgetCommand(pi).handler("toggle charts", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported widget target: charts"),
      "error",
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("Widget collapsed"),
      "info",
    );
  });

  it("collapses only the targeted widget", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const disposeSubagents = registerWidgetProvider({
      name: "subagents",
      label: "Subagents",
      render: (width) =>
        formatSubagentWidget([{ id: "s1", state: "running" }], {
          width: width >= 80 ? width : 0,
        }),
    });
    const disposeTasks = registerWidgetProvider({
      name: "tasks",
      label: "Tasks",
      render: (width) =>
        formatTaskWidget([{ id: "t1", status: "running" }], {
          width: width >= 80 ? width : 0,
        }),
    });
    try {
      const ctx = widgetCtx();
      await eventHandler(pi, "session_start")?.({}, ctx);
      mountWidgetProviders(ctx as never);
      ctx.ui.setWidget.mockClear();

      await widgetCommand(pi).handler("toggle subagents", ctx);

      const widgets = new Map(
        ctx.ui.setWidget.mock.calls.map(([name, factory]) => [name, factory]),
      );
      expect(widgets.get("subagents")).toBeUndefined();
      expect(typeof widgets.get("tasks")).toBe("function");
    } finally {
      disposeSubagents();
      disposeTasks();
    }
  });

  it("toggling changes widget state and targets are completable", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = uiCtx();
    const widget = widgetCommand(pi);
    const targets = (widget.getArgumentCompletions("toggle ") ?? []).map(
      (item) => item.value,
    );

    expect(targets).toEqual([
      "toggle todos",
      "toggle tasks",
      "toggle subagents",
      "toggle all",
    ]);

    await widget.handler("toggle", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Widget collapsed", "info");

    await widget.handler("toggle", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Widget expanded", "info");
  });
});
