import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

describe("S147 no injected search tools", () => {
  it("registers no model tools at all", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };

    extension(pi as never);

    expect(pi.registerTool).not.toHaveBeenCalled();
  });
});
