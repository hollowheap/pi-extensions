import { describe, expect, it, vi } from "vitest";
import { createSubagentsExtension } from "./index.js";

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
});
