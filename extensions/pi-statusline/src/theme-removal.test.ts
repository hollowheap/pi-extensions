import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

describe("statusline theme ownership", () => {
  it("S194 C01: no theme command or picker is registered", () => {
    const registered: string[] = [];
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerShortcut: vi.fn(),
      registerCommand: vi.fn((name: string) => registered.push(name)),
      events: { on: vi.fn(() => () => {}), emit: vi.fn() },
      getCommands: vi.fn(() => []),
    };
    extension(pi as never);
    expect(registered).not.toContain("theme");
  });
});
