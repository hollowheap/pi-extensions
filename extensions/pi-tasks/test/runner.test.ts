import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTaskRecord,
  readTaskMetadata,
  taskLogPath,
} from "../src/registry.js";
import {
  cancelTask,
  readProcStartTime,
  reconcileAllTasks,
  reconcileTask,
  spawnShellTask,
  waitForTask,
} from "../src/runner.js";
import { CONFIG_FILE_NAME } from "../src/settings.js";

function isRunningPid(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/)[0];
    return state !== undefined && state !== "Z" && state !== "X";
  } catch {
    return false;
  }
}

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

    const finished = await waitForTask(agentDir, task.id, 5000);
    expect(finished?.status).toBe("completed");
    expect(finished?.exitCode).toBe(0);
    expect(finished?.finishedAt).toBeTypeOf("number");

    const output = await finished?.output();
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

  it("waits for the shim to publish a pid before failing a new task", () => {
    createTaskRecord(agentDir, {
      id: "task-starting",
      kind: "shell",
      status: "running",
      command: "sleep 60",
      cwd: process.cwd(),
      startedAt: Date.now(),
    });
    expect(reconcileTask(agentDir, "task-starting")?.status).toBe("running");

    createTaskRecord(agentDir, {
      id: "task-stale-start",
      kind: "shell",
      status: "running",
      command: "sleep 60",
      cwd: process.cwd(),
      startedAt: Date.now() - 10_000,
    });
    expect(reconcileTask(agentDir, "task-stale-start")?.status).toBe("failed");
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

    await new Promise((r) => setTimeout(r, 200));

    const cancelled = await cancelTask(agentDir, task.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.finishedAt).toBeTypeOf("number");

    const persisted = readTaskMetadata(agentDir, task.id);
    expect(persisted?.status).toBe("cancelled");
  });

  it("kills the inner detached group when cancelling a TERM-resistant task", async () => {
    const pidFile = join(agentDir, "child.pid");
    const task = await spawnShellTask({
      agentDir,
      command: `trap '' TERM INT; echo $$ > "${pidFile}"; while :; do sleep 0.2; done`,
      cwd: process.cwd(),
    });

    let innerPid = 0;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        if (existsSync(pidFile)) {
          const parsed = Number.parseInt(
            readFileSync(pidFile, "utf8").trim(),
            10,
          );
          const meta = readTaskMetadata(agentDir, task.id);
          if (
            Number.isInteger(parsed) &&
            parsed > 0 &&
            meta?.innerPid === parsed
          ) {
            innerPid = parsed;
            break;
          }
        }
      } catch {
        // Not published yet.
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(innerPid).toBeGreaterThan(0);
    expect(isRunningPid(innerPid)).toBe(true);

    try {
      const cancelled = await cancelTask(agentDir, task.id, 100);
      expect(cancelled?.status).toBe("cancelled");
      expect(readTaskMetadata(agentDir, task.id)?.status).toBe("cancelled");
      expect(isRunningPid(innerPid)).toBe(false);
    } finally {
      try {
        process.kill(innerPid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  it("reports cancel as cancelled rather than a stale running state", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "sleep 30",
      cwd: process.cwd(),
    });
    await new Promise((r) => setTimeout(r, 200));

    const cancelled = await cancelTask(agentDir, task.id, 50);
    expect(cancelled?.status).toBe("cancelled");
    expect(readTaskMetadata(agentDir, task.id)?.status).toBe("cancelled");
  });

  it("reaps background children in the task process group when the shell exits", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "sleep 60 & echo $!; exit 0",
      cwd: process.cwd(),
    });

    const finished = await waitForTask(agentDir, task.id, 5_000);
    expect(finished?.status).toBe("completed");
    const out = (await finished?.output())?.trim() ?? "";
    const bgPid = Number.parseInt(out, 10);
    expect(bgPid).toBeGreaterThan(0);

    let alive = false;
    try {
      process.kill(bgPid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    try {
      if (alive) process.kill(bgPid, "SIGKILL");
    } catch {}
    expect(alive).toBe(false);
  });

  it("wraps only the inner task command with bwrap when sandbox is enabled in tasks.json", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "pi-tasks-bwrap-"));
    const argsLog = join(binDir, "bwrap-args.txt");
    const fakeBwrap = join(binDir, "bwrap");
    writeFileSync(
      fakeBwrap,
      `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args));
const sep = args.indexOf("--");
const cmd = args[sep + 1];
const cmdArgs = args.slice(sep + 2);
const res = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
process.exit(res.status ?? 1);
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(agentDir, CONFIG_FILE_NAME),
      JSON.stringify({ sandbox: { enabled: true, offline: true } }),
    );
    const workDir = mkdtempSync(join(tmpdir(), "pi-tasks-cwd-"));
    try {
      const task = await spawnShellTask({
        agentDir,
        command: "echo sandboxed-task-ok",
        cwd: workDir,
        sandbox: { offline: true, bwrapBinary: fakeBwrap },
      });
      const finished = await waitForTask(agentDir, task.id, 5_000);
      expect(finished?.status).toBe("completed");
      expect(await finished?.output()).toContain("sandboxed-task-ok");
      const recorded = JSON.parse(readFileSync(argsLog, "utf8")) as string[];
      expect(recorded).toContain("--ro-bind");
      expect(recorded).toContain("--unshare-net");
      expect(recorded).toContain(workDir);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("fails closed with OS permission error when bwrap is not executable", async () => {
    if (process.getuid?.() === 0) return;
    const binDir = mkdtempSync(join(tmpdir(), "pi-tasks-bwrap-perm-"));
    const fakeBwrap = join(binDir, "bwrap");
    writeFileSync(fakeBwrap, "#!/bin/sh\nexit 0\n");
    chmodSync(fakeBwrap, 0o644);
    try {
      await expect(
        spawnShellTask({
          agentDir,
          command: "echo hi",
          cwd: process.cwd(),
          sandbox: { bwrapBinary: fakeBwrap },
        }),
      ).rejects.toThrow(/permission/i);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
