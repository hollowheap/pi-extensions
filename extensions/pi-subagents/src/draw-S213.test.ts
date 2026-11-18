import { describe, expect, it, vi } from "vitest";
import { createSubagentsExtension } from "./index.js";

function register(listSubagents = vi.fn(async () => [])) {
  const handlers: Record<string, (...args: never[]) => unknown> = {};
  const pi = {
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers[event] = handler;
      return () => {};
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
  createSubagentsExtension({
    getAgentDir: () => "/tmp/draw-subagents",
    listSubagents,
  })(pi as never);
  return { handlers, pi, listSubagents };
}

describe("subagent turn ownership", () => {
  it("S213 C01: subscribes to turn end so turn-scoped children are cancelled", () => {
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const pi = {
      on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
        handlers[event] = handler;
        return () => {};
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    createSubagentsExtension({
      getAgentDir: () => "/tmp/draw-subagents",
      listSubagents: vi.fn(async () => []),
    })(pi as never);

    expect(handlers.turn_end).toBeTypeOf("function");
  });

  it("S213 C02: the extension registers a tool and a command", () => {
    const { pi } = register();
    expect(pi.registerTool).toHaveBeenCalled();
    expect(pi.registerCommand).toHaveBeenCalled();
  });

  it("S213 C03: turn end without a turn start does not scan subagents", () => {
    const { handlers, listSubagents } = register();
    expect(() =>
      handlers.turn_end?.({}, { cwd: "/tmp/draw-subagents" }),
    ).not.toThrow();
    expect(listSubagents).not.toHaveBeenCalled();
  });

  it("S213 C04: a turn end after a turn start scans turn-scoped children", async () => {
    const listSubagents = vi.fn(async () => []);
    const { handlers } = register(listSubagents);
    handlers.turn_start?.({}, { cwd: "/tmp/draw-subagents" });
    handlers.turn_end?.({}, { cwd: "/tmp/draw-subagents" });
    await vi.waitFor(() => expect(listSubagents).toHaveBeenCalled());
  });
});
