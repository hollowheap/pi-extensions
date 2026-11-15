import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension, { createSubagentsExtension } from "./index.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createMockPi() {
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    appendEntry: vi.fn(),
    events: {
      emit: vi.fn((event: string, ...args: unknown[]) => {
        const list = eventHandlers.get(event) ?? [];
        for (const h of list) h(...args);
      }),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = eventHandlers.get(event) ?? [];
        list.push(handler);
        eventHandlers.set(event, list);
      }),
    },
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
    sessionStartHandler?.({}, { sessionManager: { getBranch: () => [] } });

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
      expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
        name: "subagents",
        text: "1 subagent",
      });
    });

    pi.events.emit.mockClear();
    pi.events.emit("statusline:request", { names: ["subagents"] });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "subagents",
      text: "1 subagent",
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
    sessionStart?.({}, { sessionManager: { getBranch: () => [] } });
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

  it("publishes subagents snapshot on session_start, session_tree, and definition changes", async () => {
    const pi = createMockPi();
    const mockList = vi.fn().mockReturnValue([
      {
        id: "sub-alpha",
        status: "running",
        agent: "scout",
        task: "Inspect",
        startedAt: 1000,
      },
      {
        id: "sub-beta",
        status: "completed",
        agent: "coder",
        task: "Build",
        startedAt: 900,
      },
    ]);
    const ext = createSubagentsExtension({
      getAgentDir: () => "/tmp/agent",
      listSubagents: mockList,
    });
    ext(pi as never);

    const sessionManager = { getBranch: () => [] };
    const sessionStart = pi.on.mock.calls.find(
      ([event]) => event === "session_start",
    )?.[1];
    sessionStart?.({}, { sessionManager });

    await vi.waitFor(() => {
      const snap = getSessionSnapshot(sessionManager);
      expect(snap.subagents).toBeDefined();
      expect(snap.subagents?.total).toBe(2);
      expect(snap.subagents?.running).toBe(1);
      expect(snap.subagents?.items).toHaveLength(1);
      expect(snap.subagents?.items[0]?.id).toBe("sub-alpha");
    });

    // Test definition changes
    const tool = pi.registerTool.mock.calls[0][0];
    await tool.execute(
      "call-def",
      {
        action: "define",
        name: "custom-bot",
        description: "Custom agent",
        systemPrompt: "You are custom",
      },
      undefined,
      undefined,
      { sessionManager } as never,
    );

    await vi.waitFor(() => {
      const snap = getSessionSnapshot(sessionManager);
      expect(snap.subagents?.sessionDefinitions).toContain("custom-bot");
    });
  });

  it("supports /subagent settings and config alias with completions and OS permission errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-settings-"));
    tempDirs.push(dir);
    const pi = createMockPi();
    const ext = createSubagentsExtension({
      getAgentDir: () => dir,
      listSubagents: vi.fn().mockResolvedValue([]),
    });
    ext(pi as never);

    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string }> | null;
    };

    expect(
      (command.getArgumentCompletions?.("") ?? []).map((item) => item.value),
    ).toEqual(["logs", "pause", "resume", "steer", "settings", "config"]);
    expect(
      (command.getArgumentCompletions?.("co") ?? []).map((item) => item.value),
    ).toEqual(["config"]);
    expect(command.getArgumentCompletions?.("config extra")).toBeNull();

    let component:
      | { handleInput(data: string): void; render(width: number): string[] }
      | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => {
          handleInput(data: string): void;
          render(width: number): string[];
        },
      ) =>
        new Promise<void>((resolve) => {
          component = factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, s: string) => s, bold: (s: string) => s },
            {},
            resolve,
          );
        }),
    );
    const notify = vi.fn();
    const pending = command.handler("config", {
      cwd: dir,
      hasUI: true,
      mode: "tui",
      sessionManager: {},
      ui: { notify, custom },
    });
    await vi.waitFor(() => expect(component).toBeDefined());
    const rendered = component?.render(80).join("\n") ?? "";
    expect(rendered).toContain("Subagent settings");
    expect(rendered).toContain("Bubblewrap (bwrap):");
    component?.handleInput("\r");
    component?.handleInput("\x1b[B");
    component?.handleInput("\r");
    component?.handleInput("\x1b");
    await pending;

    const saved = JSON.parse(
      readFileSync(join(dir, "subagents.json"), "utf8"),
    ) as { sandbox?: { enabled?: boolean; offline?: boolean } };
    expect(saved.sandbox).toEqual({ enabled: true, offline: true });
    expect(notify).toHaveBeenCalledWith("Subagent settings saved", "info");

    if (process.getuid?.() !== 0) {
      const cfgPath = join(dir, "subagents.json");
      chmodSync(cfgPath, 0o000);
      try {
        const permNotify = vi.fn();
        await command.handler("settings", {
          cwd: dir,
          hasUI: true,
          mode: "print",
          sessionManager: {},
          ui: { notify: permNotify },
        });
        expect(permNotify).toHaveBeenCalledWith(
          expect.stringContaining("OS permission denied"),
          "error",
        );
      } finally {
        chmodSync(cfgPath, 0o600);
      }
    }
  });
});
