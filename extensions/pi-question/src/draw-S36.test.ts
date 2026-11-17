import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

describe("S36: pi-question registers a codemode tool, not a message_end parser", () => {
  it("registers one codemode question tool and restores state without a message_end handler", () => {
    const handlers: Record<string, unknown> = {};
    const pi = {
      on: vi.fn((event: string, handler: unknown) => {
        handlers[event] = handler;
        return () => {};
      }),
      registerTool: vi.fn(),
      appendEntry: vi.fn(),
      getActiveTools: vi.fn(() => []),
      getAllTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };

    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("question");
    expect(tool.exposure).toBe("codemode");
    expect(handlers.message_end).toBeUndefined();
    expect(handlers.session_start).toBeDefined();
    expect(handlers.session_tree).toBeDefined();
  });
});
