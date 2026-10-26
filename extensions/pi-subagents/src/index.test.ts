import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

describe("pi-subagents extension", () => {
  it("loads and registers nothing", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    };
    extension(pi as never);

    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.registerShortcut).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });
});
