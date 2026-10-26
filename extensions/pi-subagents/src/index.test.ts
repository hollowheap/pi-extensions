import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
  };
}

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_ACP");
});

describe("pi-subagents extension", () => {
  it("registers one direct subagent tool", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("subagent");
    expect(tool.exposure).toBe("direct");
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });

  it("registers nothing under ACP", () => {
    process.env.PI_ACP = "1";
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
  });
});
