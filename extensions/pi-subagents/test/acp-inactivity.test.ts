import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubagentsExtension } from "../src/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ACP inactivity", () => {
  it("registers no tool and starts no children under PI_ACP", () => {
    vi.stubEnv("PI_ACP", "1");
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      on: vi.fn(),
      events: { emit: vi.fn() },
    };
    createSubagentsExtension()(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });

  it("without ACP the extension registers a tool, a command, and hooks", () => {
    Reflect.deleteProperty(process.env, "PI_ACP");
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      on: vi.fn(),
      events: { emit: vi.fn() },
    };
    createSubagentsExtension()(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "subagent",
      expect.any(Object),
    );
    expect(pi.on).toHaveBeenCalled();
  });

  it("a truthy non-1 ACP flag also skips registration without throwing", () => {
    vi.stubEnv("PI_ACP", "true");
    expect(() => createSubagentsExtension()({} as never)).not.toThrow();
  });

  it("the command exposes its full set of action completions", () => {
    Reflect.deleteProperty(process.env, "PI_ACP");
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      on: vi.fn(),
      events: { emit: vi.fn() },
    };
    createSubagentsExtension()(pi as never);
    const command = pi.registerCommand.mock.calls[0][1];
    const completions = command.getArgumentCompletions("");
    expect(completions.map((item: { value: string }) => item.value)).toEqual(
      expect.arrayContaining(["view", "pause", "resume", "steer", "settings"]),
    );
  });
});
