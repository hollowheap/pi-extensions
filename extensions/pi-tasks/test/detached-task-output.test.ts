import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeTaskMetadata } from "../src/registry.js";
import {
  cancelTask,
  reconcileTask,
  spawnShellTask,
  waitForTask,
} from "../src/runner.js";

describe("durable tasks spawn detached and publish stdout/stderr to the log", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-draw-runner-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("streams both streams and atomically records completion", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "echo out-line; echo err-line >&2",
      cwd: process.cwd(),
    });
    expect(task.id).toMatch(/^task-/);
    expect(task.kind).toBe("shell");
    expect(task.pid).toBeTypeOf("number");

    const finished = await waitForTask(agentDir, task.id, 5000);
    expect(finished?.status).toBe("completed");
    expect(finished?.exitCode).toBe(0);
    expect(finished?.finishedAt).toBeTypeOf("number");
    const output = await finished?.output();
    expect(output).toContain("out-line");
    expect(output).toContain("err-line");
  });

  it("records a non-zero exit as failed with its exit code", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "echo failing; exit 3",
      cwd: process.cwd(),
    });
    const finished = await waitForTask(agentDir, task.id, 5000);
    expect(finished?.status).toBe("failed");
    expect(finished?.exitCode).toBe(3);
    expect(await finished?.output()).toContain("failing");
  });

  it("leaves a long-running task running when the wait deadline elapses", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "sleep 5",
      cwd: process.cwd(),
    });
    const pending = await waitForTask(agentDir, task.id, 50);
    expect(pending?.status).toBe("running");
    await cancelTask(agentDir, task.id);
  });

  it("reconciles a dead shim into a failed task without an exit code", () => {
    writeTaskMetadata(agentDir, {
      id: "dead",
      kind: "shell",
      status: "running",
      command: "true",
      cwd: "/repo",
      pid: 2147483647,
      startedAt: Date.now(),
    });
    const reconciled = reconcileTask(agentDir, "dead");
    expect(reconciled?.status).toBe("failed");
    expect(reconciled?.exitCode).toBeNull();
    expect(reconciled?.finishedAt).toBeTypeOf("number");
  });
});
