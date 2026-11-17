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
});
