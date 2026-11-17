import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
  return {
    on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers[event] = handler;
      return () => {};
    }),
    events: { on: vi.fn(), emit: vi.fn() },
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    registerTool: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
    handlers,
  };
}

function context(branch: unknown[]) {
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
    sessionManager: { getBranch: () => branch },
  };
}

describe("S53: todo state is restored from the branch-local custom entry", () => {
  it("restores branch state on session_start and installs the todos widget", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = context([
      {
        type: "custom",
        customType: "hollowheap.todos",
        data: {
          todos: [
            { id: 1, text: "Existing task", done: true },
            { id: 2, text: "Open task", done: false },
          ],
          nextId: 3,
        },
      },
    ]);

    pi.handlers.session_start({}, ctx);

    expect(ctx.ui.setWidget).toHaveBeenCalledWith("todos", expect.any(Function));
  });
});
