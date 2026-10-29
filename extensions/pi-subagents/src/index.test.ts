import { afterEach, describe, expect, it, vi } from "vitest";
import extension, { createSubagentsExtension } from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { emit: vi.fn() },
  };
}

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_ACP");
});

describe("pi-subagents extension", () => {
  it("registers direct subagent tool and emits subagents:state on session_start", () => {
    const pi = createMockPi();
    const mockList = vi.fn().mockReturnValue([
      {
        id: "sub-1",
        status: "running",
        agent: "scout",
        task: "Analyze auth",
        startedAt: 1000,
        activeTool: "edit",
        activeToolStartedAt: 1050,
      },
    ]);
    const ext = createSubagentsExtension({
      getAgentDir: () => "/tmp/agent",
      listSubagents: mockList,
    });
    ext(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0] as {
      name: string;
      exposure: string;
    };
    expect(tool.name).toBe("subagent");
    expect(tool.exposure).toBe("direct");
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "subagent",
      expect.any(Object),
    );

    // Verify session_start hook and subagents:state emission
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith(
      "session_shutdown",
      expect.any(Function),
    );

    const sessionStartHandler = pi.on.mock.calls.find(
      ([event]) => event === "session_start",
    )?.[1];
    sessionStartHandler?.();

    expect(pi.events.emit).toHaveBeenCalledWith("subagents:state", [
      expect.objectContaining({
        id: "sub-1",
        agent: "scout",
        task: "Analyze auth",
        state: "running",
        startedAt: 1000,
        activeTool: "edit",
        activeToolStartedAt: 1050,
      }),
    ]);

    const sessionShutdownHandler = pi.on.mock.calls.find(
      ([event]) => event === "session_shutdown",
    )?.[1];
    sessionShutdownHandler?.();
  });

  it("registers nothing under ACP", () => {
    process.env.PI_ACP = "1";
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });
});
