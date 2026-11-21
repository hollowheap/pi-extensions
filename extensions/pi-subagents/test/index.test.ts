import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension, { createSubagentsExtension } from "../src/index.js";

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
        project: "/repo",
        startedAt: 1000,
        activeTool: "edit",
        activeToolStartedAt: 1050,
      },
      {
        id: "sub-foreign",
        status: "running",
        agent: "scout",
        task: "Other repo work",
        project: "/elsewhere",
        startedAt: 900,
      },
      {
        id: "sub-legacy",
        status: "running",
        agent: "scout",
        task: "Legacy run",
        startedAt: 800,
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
    sessionStartHandler?.(
      {},
      { cwd: "/repo", sessionManager: { getBranch: () => [] } },
    );

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
        project: "/repo",
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
        project: "/repo",
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
    sessionStart?.(
      {},
      { cwd: "/repo", sessionManager: { getBranch: () => [] } },
    );
    await vi.waitFor(() => expect(mockList).toHaveBeenCalled());

    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      getArgumentCompletions: (
        prefix: string,
      ) => Array<{ value: string; description?: string }>;
    };
    expect(
      command.getArgumentCompletions("vi").map((item) => item.value),
    ).toEqual(["view"]);
    expect(
      command.getArgumentCompletions("view ").map((item) => item.value),
    ).toContain("view sub-1");
    expect(
      command.getArgumentCompletions("view sub")[0]?.description,
    ).toContain("running");
  });

  it("sanitizes terminal escape sequences in completion descriptions", async () => {
    const pi = createMockPi();
    const mockList = vi.fn().mockResolvedValue([
      {
        id: "sub-ansi",
        status: "running",
        agent: "scout\x1b[31m",
        task: "Inspect \x1b]8;;https://bad.example\x07task",
        project: "/repo",
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
    sessionStart?.(
      {},
      { cwd: "/repo", sessionManager: { getBranch: () => [] } },
    );
    await vi.waitFor(() => expect(mockList).toHaveBeenCalled());

    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      getArgumentCompletions: (
        prefix: string,
      ) => Array<{ value: string; description?: string }> | null;
    };
    const description =
      command.getArgumentCompletions("view sub")?.[0]?.description ?? "";
    expect(description).not.toContain("\x1b");
    expect(description).toContain("@scout: Inspect task");
    expect(command.getArgumentCompletions("logs sub")).toBeNull();
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
        project: "/repo",
        startedAt: 1000,
      },
      {
        id: "sub-beta",
        status: "completed",
        agent: "coder",
        task: "Build",
        project: "/repo",
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
    sessionStart?.({}, { cwd: "/repo", sessionManager });

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

  it("supports /subagent settings with completions and OS permission errors", async () => {
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
    ).toEqual(["view", "pause", "resume", "steer", "settings"]);
    expect(
      (command.getArgumentCompletions?.("se") ?? []).map((item) => item.value),
    ).toEqual(["settings"]);
    expect(
      (command.getArgumentCompletions?.("co") ?? []).map((item) => item.value),
    ).toEqual([]);
    expect(command.getArgumentCompletions?.("settings extra")).toBeNull();

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
    const pending = command.handler("settings", {
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

  it("resets saved state when a later settings save fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-save-reset-"));
    tempDirs.push(dir);
    const pi = createMockPi();
    const ext = createSubagentsExtension({
      getAgentDir: () => dir,
      listSubagents: vi.fn().mockResolvedValue([]),
    });
    ext(pi as never);

    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };

    let component: { handleInput(data: string): void } | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => { handleInput(data: string): void },
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
    const pending = command.handler("settings", {
      cwd: dir,
      hasUI: true,
      mode: "tui",
      sessionManager: {},
      ui: { notify, custom },
    });
    await vi.waitFor(() => expect(component).toBeDefined());
    component?.handleInput("\r");
    writeFileSync(join(dir, "subagents.json"), "{invalid");
    component?.handleInput("\x1b[B");
    component?.handleInput("\r");
    component?.handleInput("\x1b");
    await pending;

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("failed to save settings"),
      "error",
    );
    expect(notify).not.toHaveBeenCalledWith("Subagent settings saved", "info");
  });

  it("registers a direct shortcut and command for browsing child work", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toContain(
      "subagents",
    );
    expect(pi.registerShortcut).toHaveBeenCalledWith(
      "alt+s",
      expect.objectContaining({
        description: expect.stringContaining("Browse subagent work"),
      }),
    );
  });
});
