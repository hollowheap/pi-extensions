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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";
import { createTaskRecord, readTaskMetadata, taskLogPath } from "./registry.js";
import { cancelTask, readProcStartTime, spawnShellTask } from "./runner.js";

let mockAgentDir = "/tmp/pi-tasks-index-test";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => mockAgentDir,
}));

function createMockPi() {
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
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

function createCtx(cwd: string, hasUI = true) {
  return {
    cwd,
    sessionManager: {},
    hasUI,
    isProjectTrusted: () => true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  };
}

describe("pi-tasks extension", () => {
  let workspaceDir: string;
  const origAcp = process.env.PI_ACP;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, "PI_ACP");
    mockAgentDir = mkdtempSync(join(tmpdir(), "pi-tasks-idx-agent-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "pi-tasks-idx-ws-"));
  });

  afterEach(() => {
    if (origAcp === undefined) {
      Reflect.deleteProperty(process.env, "PI_ACP");
    } else {
      process.env.PI_ACP = origAcp;
    }
    rmSync(mockAgentDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("registers only the direct task tool and no bash override or /background command", () => {
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const registeredTool = pi.registerTool.mock.calls[0]?.[0];
    expect(registeredTool?.name).toBe("task");
    expect("exposure" in (registeredTool ?? {})).toBe(false);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith("task", expect.any(Object));
    expect(pi.registerShortcut).not.toHaveBeenCalled();
  });

  it("opens task logs in the overlay pager for TUI sessions", async () => {
    const pi = createMockPi();
    extension(pi as never);
    createTaskRecord(mockAgentDir, {
      id: "task-logs",
      kind: "shell",
      status: "completed",
      command: "echo hello",
      cwd: workspaceDir,
      startedAt: Date.now(),
    });
    writeFileSync(taskLogPath(mockAgentDir, "task-logs"), "hello\nworld\n");
    const custom = vi.fn(async () => undefined);
    const ctx = {
      ...createCtx(workspaceDir),
      mode: "tui",
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        custom,
      },
    };
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };

    await command.handler("logs task-logs", ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("opens the fuzzy task picker when /task has no id", async () => {
    const pi = createMockPi();
    extension(pi as never);
    createTaskRecord(mockAgentDir, {
      id: "task-pick",
      kind: "shell",
      status: "completed",
      command: "echo picked",
      cwd: workspaceDir,
      startedAt: Date.now(),
    });
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
      ...createCtx(workspaceDir),
      mode: "tui",
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        custom,
      },
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

  it("sanitizes terminal escape sequences in task logs and picker previews", async () => {
    const pi = createMockPi();
    extension(pi as never);
    createTaskRecord(mockAgentDir, {
      id: "task-esc",
      kind: "shell",
      status: "completed",
      command: "echo \x1b]52;c;dGVzdA==\x07\x1b[31mpwn\x1b[0m\rhi",
      cwd: workspaceDir,
      startedAt: Date.now(),
    });
    writeFileSync(
      taskLogPath(mockAgentDir, "task-esc"),
      "out \x1b]0;title\x07\x1b[2Jclean\rline\n",
    );

    const notify = vi.fn();
    const ctx = {
      ...createCtx(workspaceDir),
      mode: "rpc",
      ui: {
        notify,
        setStatus: vi.fn(),
      },
    };
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };

    await command.handler("logs task-esc", ctx);
    expect(notify).toHaveBeenCalledWith("out cleanline\n", "info");

    let pickerRendered = "";
    const tuiCtx = {
      ...createCtx(workspaceDir),
      mode: "tui",
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        custom: vi.fn(
          (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: (value: string | undefined) => void,
            ) => {
              render(width: number): string[];
            },
          ) => {
            const comp = factory(
              { requestRender: vi.fn() },
              {
                fg: (_t: string, s: string) => s,
                bold: (s: string) => s,
              },
              {},
              () => {},
            );
            pickerRendered = comp.render(120).join("\n");
            return Promise.resolve(undefined);
          },
        ),
      },
    };

    await command.handler("", tuiCtx);
    expect(pickerRendered).toContain("echo pwnhi");
    expect(pickerRendered).not.toContain("\x1b");
    expect(pickerRendered).not.toContain("\r");
  });

  it("completes task log ids", () => {
    const pi = createMockPi();
    extension(pi as never);
    createTaskRecord(mockAgentDir, {
      id: "task-complete",
      kind: "shell",
      status: "completed",
      command: "echo done",
      cwd: workspaceDir,
      startedAt: Date.now(),
    });
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      getArgumentCompletions: (
        prefix: string,
      ) => Array<{ value: string; description?: string }>;
    };

    expect(
      command.getArgumentCompletions("logs ").map((item) => item.value),
    ).toContain("task-complete");
    expect(
      command.getArgumentCompletions("logs task-comp")[0]?.description,
    ).toContain("completed");
  });

  it("stays inert when PI_ACP is set", () => {
    process.env.PI_ACP = "1";
    const pi = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.on).not.toHaveBeenCalled();
  });

  it("updates ctx.ui.setStatus('tasks', '<n> running') on session_start and clears when 0", async () => {
    const pi = createMockPi();
    extension(pi as never);

    const sessionStartCall = pi.on.mock.calls.find(
      ([ev]) => ev === "session_start",
    );
    expect(sessionStartCall).toBeDefined();
    const onSessionStart = sessionStartCall?.[1] as (
      ev: unknown,
      ctx: unknown,
    ) => void;

    const ctx = createCtx(workspaceDir);

    // 0 running -> undefined
    onSessionStart({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("tasks", undefined);
    expect(pi.events.emit).toHaveBeenCalledWith("tasks:state", []);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "tasks",
      text: "",
    });

    // 1 running -> "1 running"
    createTaskRecord(mockAgentDir, {
      id: "task-live",
      kind: "shell",
      status: "running",
      command: "sleep 30",
      cwd: workspaceDir,
      pid: process.pid,
      startTime: readProcStartTime(process.pid),
      startedAt: Date.now(),
    });

    onSessionStart({}, ctx);
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("tasks", "1 running");
    expect(pi.events.emit).toHaveBeenCalledWith("tasks:state", [
      { id: "task-live", command: "sleep 30", status: "running" },
    ]);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "tasks",
      text: "1 running",
    });

    pi.events.emit.mockClear();
    pi.events.emit("statusline:request", { names: ["tasks"] });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "tasks",
      text: "1 running",
    });
  });

  it("warns instead of throwing when task storage cannot be read", () => {
    const pi = createMockPi();
    extension(pi as never);
    writeFileSync(join(mockAgentDir, "tasks"), "not a directory");
    const onSessionStart = pi.on.mock.calls.find(
      ([ev]) => ev === "session_start",
    )?.[1] as (ev: unknown, ctx: unknown) => void;
    const ctx = createCtx(workspaceDir);

    expect(() => onSessionStart({}, ctx)).not.toThrow();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("failed to restore task state"),
      "warning",
    );
  });

  it("leaves durable tasks running on session_shutdown", async () => {
    const pi = createMockPi();
    extension(pi as never);

    const task = await spawnShellTask({
      agentDir: mockAgentDir,
      command: "sleep 30",
      cwd: workspaceDir,
    });

    const shutdownCall = pi.on.mock.calls.find(
      ([ev]) => ev === "session_shutdown",
    );
    const onShutdown = shutdownCall?.[1] as (ev: unknown, ctx: unknown) => void;
    if (onShutdown) {
      onShutdown({}, createCtx(workspaceDir));
    }

    const meta = readTaskMetadata(mockAgentDir, task.id);
    expect(meta?.status).toBe("running");

    await cancelTask(mockAgentDir, task.id);
  });

  it("publishes tasks snapshot on session_start with running, total, and capped recent", () => {
    const pi = createMockPi();
    extension(pi as never);

    for (let i = 1; i <= 7; i++) {
      createTaskRecord(mockAgentDir, {
        id: `task-${i}`,
        kind: "shell",
        status: i === 1 ? "running" : "completed",
        command: `echo ${i}`,
        cwd: workspaceDir,
        pid: i === 1 ? process.pid : 99999,
        startTime: i === 1 ? readProcStartTime(process.pid) : 100,
        startedAt: 1000 * i,
        exitCode: i === 1 ? null : 0,
      });
    }

    const sessionStartCall = pi.on.mock.calls.find(
      ([ev]) => ev === "session_start",
    );
    const onSessionStart = sessionStartCall?.[1] as (
      ev: unknown,
      ctx: unknown,
    ) => void;
    const sessionManager = {};
    const ctx = { ...createCtx(workspaceDir), sessionManager };

    onSessionStart({}, ctx);

    const snap = getSessionSnapshot(sessionManager);
    expect(snap.tasks).toBeDefined();
    expect(snap.tasks?.total).toBe(7);
    expect(snap.tasks?.running).toBe(1);
    expect(snap.tasks?.recent).toHaveLength(5);
    expect(snap.tasks?.recent[0]).toMatchObject({
      id: "task-7",
      status: "completed",
      command: "echo 7",
      startedAt: 7000,
      exitCode: 0,
    });
  });

  it("supports /task settings and /task config with completions, interactive toggles, and OS permission errors", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const command = pi.registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions?: (
        prefix: string,
      ) => Array<{ value: string; label: string }> | null;
    };

    expect(
      (command.getArgumentCompletions?.("") ?? []).map((item) => item.value),
    ).toEqual(["logs", "settings", "config"]);
    expect(
      (command.getArgumentCompletions?.("co") ?? []).map((item) => item.value),
    ).toEqual(["config"]);

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
    const ctx = {
      ...createCtx(workspaceDir),
      mode: "tui",
      ui: { notify, setStatus: vi.fn(), custom },
    };

    const pending = command.handler("config", ctx);
    await vi.waitFor(() => expect(component).toBeDefined());
    const rendered = component?.render(80).join("\n") ?? "";
    expect(rendered).toContain("Tasks settings");
    expect(rendered).toContain("Bubblewrap (bwrap):");
    // Toggle sandbox enabled (item 1) and sandbox offline (item 2)
    component?.handleInput("\r");
    component?.handleInput("\x1b[B");
    component?.handleInput("\r");
    component?.handleInput("\x1b");
    await pending;

    const saved = JSON.parse(
      readFileSync(join(mockAgentDir, "tasks.json"), "utf8"),
    ) as { sandbox?: { enabled?: boolean; offline?: boolean } };
    expect(saved.sandbox).toEqual({ enabled: true, offline: true });
    expect(notify).toHaveBeenCalledWith("Tasks settings saved", "info");

    if (process.getuid?.() !== 0) {
      const cfgPath = join(mockAgentDir, "tasks.json");
      chmodSync(cfgPath, 0o000);
      try {
        const permNotify = vi.fn();
        await command.handler("settings", {
          ...createCtx(workspaceDir),
          mode: "print",
          ui: { notify: permNotify, setStatus: vi.fn() },
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
