import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";
import { createTaskRecord, readTaskMetadata } from "./registry.js";
import { readProcStartTime, spawnShellTask } from "./runner.js";

let mockAgentDir = "/tmp/pi-tasks-index-test";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => mockAgentDir,
}));

function createMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: {
      emit: vi.fn(),
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
    expect(pi.registerCommand).not.toHaveBeenCalled();
    expect(pi.registerShortcut).not.toHaveBeenCalled();
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
    expect(pi.events.emit).toHaveBeenLastCalledWith("tasks:state", [
      { id: "task-live", command: "sleep 30", status: "running" },
    ]);
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

    await task.cancel();
  });
});
