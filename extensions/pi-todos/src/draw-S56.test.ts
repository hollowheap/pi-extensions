import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(() => () => {}),
    events: { on: vi.fn(), emit: vi.fn() },
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    registerTool: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
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
    sessionManager: { getBranch: () => [] },
  };
}

describe("S56: a changed todo set appends one entry and refreshes the widget", () => {
  it("appends a hollowheap.todos entry and numbers the created tasks", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0]?.[0] as {
      execute: (
        ...args: unknown[]
      ) => Promise<{ content: Array<{ text?: string }> }>;
    };
    const ctx = context();

    const result = await tool.execute(
      "call-1",
      { action: "create", tasks: ["First task", "Second task"] },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content[0].text).toContain("1 First task");
    expect(result.content[0].text).toContain("2 Second task");
    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos: [
        { id: 1, text: "First task", done: false },
        { id: 2, text: "Second task", done: false },
      ],
      nextId: 3,
      updatedAt: expect.any(Number),
    });
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "todos",
      expect.any(Function),
    );
  });
});
