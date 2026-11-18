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

    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "todos",
      expect.any(Function),
    );
  });
});

describe("lifecycle, recovery, and status seams", () => {
  it("S53 C02: session_tree also restores state and installs the widget", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = context([
      {
        type: "custom",
        customType: "hollowheap.todos",
        data: { todos: [{ id: 1, text: "T", done: false }], nextId: 2 },
      },
    ]);

    pi.handlers.session_tree({}, ctx);

    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "todos",
      expect.any(Function),
    );
  });

  it("S53 C03: corrupt branch state falls back to an empty list without throwing", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = context([
      {
        type: "custom",
        customType: "hollowheap.todos",
        data: {
          todos: [
            { id: 1, text: "A", done: false },
            { id: 1, text: "Dup", done: false },
          ],
          nextId: 2,
        },
      },
    ]);

    expect(() => pi.handlers.session_start({}, ctx)).not.toThrow();
    const tool = pi.registerTool.mock.calls[0]?.[0] as {
      execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }>;
    };
    const result = await tool.execute(
      "c1",
      { action: "list" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content[0].text).toBe("No todos");
  });

  it("S53 C04: restoring open todos publishes a statusline count", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = context([
      {
        type: "custom",
        customType: "hollowheap.todos",
        data: {
          todos: [
            { id: 1, text: "A", done: false },
            { id: 2, text: "B", done: false },
          ],
          nextId: 3,
        },
      },
    ]);

    pi.handlers.session_start({}, ctx);

    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "todos",
      text: "2 todos",
    });
  });
});
