import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
    {};
  return {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers[event] = handler;
        return () => {};
      },
    ),
    events: { on: vi.fn(), emit: vi.fn() },
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    registerTool: vi.fn(),
    getActiveTools: vi.fn(() => ["read", "bash"]),
    getAllTools: vi.fn(() => [{ name: "codemode" }]),
    setActiveTools: vi.fn(),
    handlers,
  };
}

function context() {
  return {
    hasUI: true,
    mode: "tui",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      custom: vi.fn(),
      onTerminalInput: vi.fn(() => vi.fn()),
    },
    sessionManager: { getBranch: vi.fn(() => []) },
  };
}

describe("S143 state survives compaction", () => {
  it("re-appends the current todo state when the session compacts", () => {
    const pi = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    tool.execute(
      "call-1",
      { action: "create", text: "Compact me" },
      undefined,
      undefined,
      ctx,
    );
    pi.appendEntry.mockClear();

    pi.handlers.session_compact({}, ctx);

    expect(pi.appendEntry).toHaveBeenCalledWith(
      "hollowheap.todos",
      expect.any(Object),
    );
  });

  it("S143 C02: malformed subagent and task event payloads are ignored", () => {
    const handlers: Record<string, (data: unknown) => void> = {};
    const pi = createMockPi();
    pi.events.on.mockImplementation(
      (event: string, handler: (data: unknown) => void) => {
        handlers[event] = handler;
        return () => {};
      },
    );
    extension(pi as never);
    expect(() => {
      handlers["subagents:state"]?.("not an array");
      handlers["subagents:state"]?.([{ id: 3 }]);
      handlers["tasks:state"]?.({ nope: true });
    }).not.toThrow();
  });

  it("S143 C03: terminal listeners are disposed before replacement and on shutdown", () => {
    const pi = createMockPi();
    extension(pi as never);
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();
    const onTerminalInput = vi
      .fn()
      .mockReturnValueOnce(disposeFirst)
      .mockReturnValueOnce(disposeSecond);
    const ctx = { ...context(), ui: { ...context().ui, onTerminalInput } };

    pi.handlers.session_start?.({}, ctx);
    pi.handlers.session_start?.({}, ctx);
    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect(disposeSecond).not.toHaveBeenCalled();
    pi.handlers.session_shutdown?.({}, ctx);
    expect(disposeSecond).toHaveBeenCalledTimes(1);
  });

  it("S143 C04: a headless tool call persists state without touching widgets", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = { ...context(), hasUI: false };

    await tool.execute(
      "call-headless",
      { action: "create", text: "No UI" },
      undefined,
      undefined,
      ctx,
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "hollowheap.todos",
      expect.objectContaining({
        todos: [expect.objectContaining({ text: "No UI" })],
      }),
    );
    expect(ctx.ui.setWidget).not.toHaveBeenCalled();
  });
});
