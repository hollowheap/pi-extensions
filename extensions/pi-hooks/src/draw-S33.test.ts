import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

describe("S33: pi-hooks registers no model-callable tool", () => {
  it("registers only event handlers and commands, never a tool", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };

    extension(pi as never);

    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalled();
  });
});
