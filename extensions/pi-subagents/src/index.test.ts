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
  it("registers direct subagent tool and emits subagents:state on session_start", async () => {
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

    await vi.waitFor(() => {
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
    });

    const sessionShutdownHandler = pi.on.mock.calls.find(
      ([event]) => event === "session_shutdown",
    )?.[1];
    sessionShutdownHandler?.();
  });

  it("opens the fuzzy subagent picker when /subagent has no id", async () => {
    const pi = createMockPi();
    const mockList = vi.fn().mockResolvedValue([
      {
        id: "sub-1",
        status: "running",
        agent: "scout",
        task: "Analyze auth",
        startedAt: 1000,
      },
    ]);
    const ext = createSubagentsExtension({
      getAgentDir: () => "/tmp/agent",
      listSubagents: mockList,
    });
    ext(pi as never);

    let picker:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    let calls = 0;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (value: string | undefined) => void,
        ) => {
          handleInput(data: string): void;
          render(width: number): string[];
        },
      ) => {
        calls++;
        if (calls > 1) return Promise.resolve(undefined);
        return new Promise((resolve) => {
          picker = factory(
            { requestRender: vi.fn() },
            { fg: (_token: string, text: string) => text },
            {},
            resolve,
          );
        });
      },
    );
    const ctx = {
      cwd: "/repo",
      hasUI: true,
      mode: "tui",
      sessionManager: { getSessionId: () => "session-1" },
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), custom },
    };
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };

    const pending = command.handler("", ctx);
    await vi.waitFor(() => expect(picker).toBeDefined());
    picker?.handleInput("\r");
    await pending;

    expect(calls).toBe(2);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("completes subagent actions and ids", async () => {
    const pi = createMockPi();
    const mockList = vi.fn().mockResolvedValue([
      {
        id: "sub-1",
        status: "running",
        agent: "scout",
        task: "Analyze auth",
        startedAt: 1000,
      },
    ]);
    const ext = createSubagentsExtension({
      getAgentDir: () => "/tmp/agent",
      listSubagents: mockList,
    });
    ext(pi as never);
    const sessionStart = pi.on.mock.calls.find(
      ([event]) => event === "session_start",
    )?.[1];
    sessionStart?.();
    await vi.waitFor(() => expect(mockList).toHaveBeenCalled());

    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      getArgumentCompletions: (
        prefix: string,
      ) => Array<{ value: string; description?: string }>;
    };
    expect(
      command.getArgumentCompletions("lo").map((item) => item.value),
    ).toEqual(["logs"]);
    expect(
      command.getArgumentCompletions("logs ").map((item) => item.value),
    ).toContain("sub-1");
    expect(
      command.getArgumentCompletions("logs sub")[0]?.description,
    ).toContain("running");
  });

  it("registers nothing under ACP", () => {
    process.env.PI_ACP = "1";
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });
});
