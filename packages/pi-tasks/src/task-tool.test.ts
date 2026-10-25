import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskRecord, taskLogPath } from "./registry.js";
import { readProcStartTime } from "./runner.js";
import { createTaskTool } from "./task-tool.js";

function createCtx(opts: { cwd: string; trusted?: boolean }) {
  return {
    cwd: opts.cwd,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => opts.trusted ?? true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
  };
}

function getText(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

describe("pi-tasks task-tool", () => {
  let agentDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-agent-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "pi-tasks-ws-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("registers direct task tool without codemode exposure", () => {
    const tool = createTaskTool({ getAgentDir: () => agentDir });
    expect(tool.name).toBe("task");
    expect("exposure" in tool).toBe(false);
  });

  it("rejects start in an untrusted project before spawning", async () => {
    const tool = createTaskTool({ getAgentDir: () => agentDir });
    const ctx = createCtx({ cwd: workspaceDir, trusted: false });

    const res = await tool.execute(
      "1",
      { action: "start", command: "echo hello" } as never,
      undefined,
      undefined,
      ctx as never,
    );

    expect(getText(res as never)).toContain("trusted project");
  });

  it("rejects start when command is denied by permissions", async () => {
    mkdirSync(join(workspaceDir, ".pi"), { recursive: true });
    writeFileSync(
      join(workspaceDir, ".pi", "permissions.json"),
      JSON.stringify({ rules: ["deny shell rm"] }),
    );
    const tool = createTaskTool({ getAgentDir: () => agentDir });
    const ctx = createCtx({ cwd: workspaceDir, trusted: true });

    const res = await tool.execute(
      "1",
      { action: "start", command: "rm -rf build" } as never,
      undefined,
      undefined,
      ctx as never,
    );

    expect(getText(res as never)).toContain("denied");
  });

  it("starts a background task, lists it, waits for completion, and reads truncated status output", async () => {
    const onStatusChange = vi.fn();
    const tool = createTaskTool({
      getAgentDir: () => agentDir,
      onStatusChange,
    });
    const ctx = createCtx({ cwd: workspaceDir, trusted: true });

    const started = await tool.execute(
      "1",
      { action: "start", command: "echo task-output-ok" } as never,
      undefined,
      undefined,
      ctx as never,
    );
    const startText = getText(started as never);
    expect(startText).toContain("Started task");
    const idMatch = startText.match(/task-[a-z0-9]+-[a-f0-9]+/);
    expect(idMatch).not.toBeNull();
    const taskId = idMatch?.[0] ?? "";

    const listed = await tool.execute(
      "2",
      { action: "list" } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(listed as never)).toContain(taskId);

    const waited = await tool.execute(
      "3",
      { action: "wait", id: taskId, timeoutMs: 5000 } as never,
      undefined,
      undefined,
      ctx as never,
    );
    const waitText = getText(waited as never);
    expect(waitText).toContain("completed");
    expect(waitText).toContain("task-output-ok");

    // Verify status truncates large logs with core truncateText
    writeFileSync(
      taskLogPath(agentDir, taskId),
      `${"a".repeat(2500)}${"b".repeat(2500)}`,
      { mode: 0o600 },
    );
    const statusRes = await tool.execute(
      "4",
      { action: "status", id: taskId } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(statusRes as never)).toContain("cut 1000 characters");
    expect(onStatusChange).toHaveBeenCalled();
  });

  it("supports cross-restart wait, timeout, cancel, unknown IDs, and validation errors without throwing", async () => {
    const tool = createTaskTool({ getAgentDir: () => agentDir });
    const ctx = createCtx({ cwd: workspaceDir, trusted: true });

    createTaskRecord(agentDir, {
      id: "task-running-1",
      kind: "shell",
      status: "running",
      command: "sleep 30",
      cwd: workspaceDir,
      pid: process.pid,
      startTime: readProcStartTime(process.pid),
      startedAt: Date.now(),
    });

    // Timeout while still running
    const timedOut = await tool.execute(
      "1",
      { action: "wait", id: "task-running-1", timeoutMs: 50 } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(timedOut as never)).toContain("running");

    // Spawn a real sleep task and cancel it
    const started = await tool.execute(
      "2",
      { action: "start", command: "sleep 30" } as never,
      undefined,
      undefined,
      ctx as never,
    );
    const sleepId =
      getText(started as never).match(/task-[a-z0-9]+-[a-f0-9]+/)?.[0] ?? "";
    const cancelled = await tool.execute(
      "3",
      { action: "cancel", id: sleepId } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(cancelled as never)).toContain("cancelled");

    // Unknown ID
    const unknown = await tool.execute(
      "4",
      { action: "status", id: "task-nonexistent" } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(unknown as never)).toContain("not found");

    // Validation errors
    const missingCmd = await tool.execute(
      "5",
      { action: "start" } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(missingCmd as never)).toContain("requires a command");

    const missingId = await tool.execute(
      "6",
      { action: "status" } as never,
      undefined,
      undefined,
      ctx as never,
    );
    expect(getText(missingId as never)).toContain("requires an id");
  });
});
