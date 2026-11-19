import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import extension from "../src/index.js";

describe("pi-tasks registers only the direct task tool", () => {
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

  it("subscribes to session lifecycle and statusline events", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    };
    extension(pi as never);
    const events = pi.on.mock.calls.map(([event]) => event);
    expect(events).toContain("session_start");
    expect(events).toContain("session_shutdown");
    expect(pi.events.on).toHaveBeenCalledWith(
      "statusline:request",
      expect.any(Function),
    );
  });

  it("stays inert when PI_ACP is set", () => {
    const previous = process.env.PI_ACP;
    process.env.PI_ACP = "1";
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    };
    try {
      extension(pi as never);
      expect(pi.registerTool).not.toHaveBeenCalled();
      expect(pi.registerCommand).not.toHaveBeenCalled();
      expect(pi.on).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "PI_ACP");
      else process.env.PI_ACP = previous;
    }
  });

  it("registers the task command with argument completions", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    };
    extension(pi as never);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "task",
      expect.objectContaining({
        description: expect.any(String),
        getArgumentCompletions: expect.any(Function),
      }),
    );
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      getArgumentCompletions: (prefix: string) => Array<{ value: string }>;
    };
    expect(command.getArgumentCompletions("lo").map((c) => c.value)).toContain(
      "logs",
    );
  });
});
