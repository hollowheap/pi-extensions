import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskRecord, readTaskMetadata, taskLogPath } from "./registry.js";
import {
  cancelTask,
  readProcStartTime,
  reconcileAllTasks,
  reconcileTask,
  spawnShellTask,
  waitForTask,
} from "./runner.js";

describe("pi-tasks runner", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-runner-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("spawns a detached shell task, streams stdout/stderr to <id>.log, and writes exit state to <id>.json", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "echo out-line; echo err-line >&2",
      cwd: process.cwd(),
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.kind).toBe("shell");
    expect(task.pid).toBeTypeOf("number");

    const finished = await task.wait(5000);
    expect(finished.status).toBe("completed");
    expect(finished.exitCode).toBe(0);
    expect(finished.finishedAt).toBeTypeOf("number");

    const output = await finished.output();
    expect(output).toContain("out-line");
    expect(output).toContain("err-line");
  });

  it("records non-zero exit code as failed", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "echo failing && exit 7",
      cwd: process.cwd(),
    });

    const finished = await waitForTask(agentDir, task.id, 5000);
    expect(finished?.status).toBe("failed");
    expect(finished?.exitCode).toBe(7);
    expect(await finished?.output()).toContain("failing");
  });

  it("reconciles dead PIDs and PID-reuse startTime mismatches to failed", () => {
    createTaskRecord(agentDir, {
      id: "task-dead",
      kind: "shell",
      status: "running",
      command: "sleep 60",
      cwd: process.cwd(),
      pid: 99999999,
      startTime: 12345,
      startedAt: 1000,
    });

    const reconciledDead = reconcileTask(agentDir, "task-dead");
    expect(reconciledDead?.status).toBe("failed");
    expect(reconciledDead?.exitCode).toBeNull();
    expect(reconciledDead?.finishedAt).toBeTypeOf("number");

    const currentStartTime = readProcStartTime(process.pid);
    createTaskRecord(agentDir, {
      id: "task-reused-pid",
      kind: "shell",
      status: "running",
      command: "sleep 60",
      cwd: process.cwd(),
      pid: process.pid,
      startTime: (currentStartTime ?? 100) + 999999,
      startedAt: 1000,
    });

    const all = reconcileAllTasks(agentDir);
    const reused = all.find((t) => t.id === "task-reused-pid");
    expect(reused?.status).toBe("failed");
    expect(reused?.exitCode).toBeNull();
  });

  it("supports cross-restart wait by watching/polling <id>.json", async () => {
    createTaskRecord(agentDir, {
      id: "task-cross",
      kind: "shell",
      status: "running",
      command: "sleep 1",
      cwd: process.cwd(),
      pid: process.pid,
      startTime: readProcStartTime(process.pid),
      startedAt: Date.now(),
    });

    setTimeout(() => {
      writeFileSync(
        taskLogPath(agentDir, "task-cross"),
        "done across restart\n",
        {
          mode: 0o600,
        },
      );
      createTaskRecord(agentDir, {
        id: "task-cross",
        kind: "shell",
        status: "completed",
        command: "sleep 1",
        cwd: process.cwd(),
        pid: process.pid,
        startTime: readProcStartTime(process.pid),
        startedAt: Date.now() - 100,
        finishedAt: Date.now(),
        exitCode: 0,
      });
    }, 80);

    const finished = await waitForTask(agentDir, "task-cross", 3000);
    expect(finished?.status).toBe("completed");
    expect(finished?.exitCode).toBe(0);
    expect(await finished?.output()).toBe("done across restart\n");
  });

  it("cancels a running shell task and terminates its process group", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "sleep 30",
      cwd: process.cwd(),
    });

    const cancelled = await cancelTask(agentDir, task.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.finishedAt).toBeTypeOf("number");

    const persisted = readTaskMetadata(agentDir, task.id);
    expect(persisted?.status).toBe("cancelled");
  });
});
