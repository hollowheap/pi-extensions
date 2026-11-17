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

describe("S58: before_agent_start contributes a stable todos_format section", () => {
  it("guides the model to the codemode todo tool rather than tagged blocks", () => {
    const pi = createMockPi();
    extension(pi as never);
    const event = {
      systemPromptOptions: { sections: {} as Record<string, string> },
    };
    const ctx = {
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

    pi.handlers.before_agent_start(event, ctx);

    const section = event.systemPromptOptions.sections.todos_format;
    expect(section).toContain("tools.todo");
    expect(section).not.toContain("create_todos");
    expect(section).not.toContain("complete_todos");
  });
});
