import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import extension from "./index.js";

describe("S73: pi-tasks registers only the direct task tool", () => {
  it("does not override bash, add a shortcut, or activate codemode", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    };
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0]?.[0] as
      | { name: string }
      | undefined;
    expect(tool?.name).toBe("task");
    expect("exposure" in (tool ?? {})).toBe(false);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith("task", expect.any(Object));
    expect(pi.registerShortcut).not.toHaveBeenCalled();
  });
});
