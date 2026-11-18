import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    events: { on: vi.fn(), emit: vi.fn() },
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

describe("S218 widget command surface", () => {
  it("registers a widget command in place of panel", () => {
    const pi = createMockPi();
    extension(pi as never);

    const names = pi.registerCommand.mock.calls.map(([name]) => name);
    expect(names).toContain("widget");
    expect(names).not.toContain("panel");
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

  it("S218 C02: a bare widget command reports usage instead of toggling", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = uiCtx();

    await widgetCommand(pi).handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /widget toggle [todos|tasks|subagents|all]",
      "info",
    );
  });

  it("S218 C03: an unsupported widget target is refused with an error", async () => {
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

  it("S218 C04: toggling changes widget state and targets are completable", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = uiCtx();
    const widget = widgetCommand(pi);
    const targets = (widget.getArgumentCompletions("toggle ") ?? []).map(
      (item) => item.value,
    );

    expect(targets).toEqual(["todos", "tasks", "subagents", "all"]);

    await widget.handler("toggle", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Widget collapsed", "info");

    await widget.handler("toggle", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("Widget expanded", "info");
  });
});
