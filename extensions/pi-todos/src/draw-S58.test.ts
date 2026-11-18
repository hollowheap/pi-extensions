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

describe("gating, missing options, and lifecycle seams", () => {
  function ui() {
    return {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      custom: vi.fn(),
      onTerminalInput: vi.fn(() => vi.fn()),
    };
  }

  it("S58 C02: no prompt section is added without a UI", () => {
    const pi = createMockPi();
    extension(pi as never);
    const event = {
      systemPromptOptions: { sections: {} as Record<string, string> },
    };
    const ctx = { hasUI: false, ui: ui() };

    pi.handlers.before_agent_start(event, ctx);

    expect(event.systemPromptOptions.sections.todos_format).toBeUndefined();
  });

  it("S58 C03: an event without systemPromptOptions is left untouched", () => {
    const pi = createMockPi();
    extension(pi as never);
    const event: Record<string, unknown> = {};
    const ctx = { hasUI: true, ui: ui() };

    expect(() => pi.handlers.before_agent_start(event, ctx)).not.toThrow();
    expect(event.systemPromptOptions).toBeUndefined();
  });

  it("S58 C04: session_start reconciles active tools toward codemode", () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const setActiveTools = vi.fn();
    const pi = {
      ...createMockPi(),
      on: vi.fn(
        (event: string, handler: (event: unknown, ctx: unknown) => void) => {
          handlers[event] = handler;
          return () => {};
        },
      ),
      getActiveTools: vi.fn(() => ["todo", "bash"]),
      getAllTools: vi.fn(() => [{ name: "codemode" }]),
      setActiveTools,
    };
    extension(pi as never);
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: ui(),
      sessionManager: { getBranch: () => [] },
    };

    handlers.session_start?.({}, ctx);

    expect(setActiveTools).toHaveBeenCalledWith(["bash", "codemode"]);
  });
});
