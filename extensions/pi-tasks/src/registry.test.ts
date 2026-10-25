import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTaskRecord,
  listTaskMetadata,
  readTaskMetadata,
  taskLogPath,
  taskMetaPath,
  tasksDir,
  writeTaskMetadata,
} from "./registry.js";

describe("pi-tasks registry", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-registry-"));
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("creates <agentDir>/tasks with 0700 and persists <id>.json and <id>.log with 0600", async () => {
    const record = createTaskRecord(agentDir, {
      id: "task-1",
      kind: "shell",
      status: "running",
      command: "echo hello",
      cwd: "/repo",
      pid: 12345,
      startTime: 987654,
      startedAt: 1700000000000,
    });

    const dirStat = statSync(tasksDir(agentDir));
    expect(dirStat.mode & 0o777).toBe(0o700);

    const metaStat = statSync(taskMetaPath(agentDir, "task-1"));
    expect(metaStat.mode & 0o777).toBe(0o600);

    const logStat = statSync(taskLogPath(agentDir, "task-1"));
    expect(logStat.mode & 0o777).toBe(0o600);

    expect(record.id).toBe("task-1");
    expect(record.kind).toBe("shell");
    expect(record.status).toBe("running");
    expect(record.command).toBe("echo hello");
    expect(record.cwd).toBe("/repo");
    expect(record.pid).toBe(12345);
    expect(record.startTime).toBe(987654);
    expect(record.startedAt).toBe(1700000000000);
    expect("inbox" in record).toBe(false);
    expect("outbox" in record).toBe(false);

    writeFileSync(taskLogPath(agentDir, "task-1"), "hello\n", { mode: 0o600 });
    expect(await record.output()).toBe("hello\n");
  });

  it("atomically updates metadata and reads/lists persisted records", () => {
    createTaskRecord(agentDir, {
      id: "task-a",
      kind: "shell",
      status: "running",
      command: "sleep 1",
      cwd: "/repo",
      pid: 100,
      startTime: 200,
      startedAt: 1000,
    });

    writeTaskMetadata(agentDir, {
      id: "task-a",
      kind: "shell",
      status: "completed",
      command: "sleep 1",
      cwd: "/repo",
      pid: 100,
      startTime: 200,
      startedAt: 1000,
      finishedAt: 2000,
      exitCode: 0,
    });

    const loaded = readTaskMetadata(agentDir, "task-a");
    expect(loaded).toEqual({
      id: "task-a",
      kind: "shell",
      status: "completed",
      command: "sleep 1",
      cwd: "/repo",
      pid: 100,
      startTime: 200,
      startedAt: 1000,
      finishedAt: 2000,
      exitCode: 0,
    });

    const all = listTaskMetadata(agentDir);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("task-a");
    expect(all[0]?.status).toBe("completed");
  });
});
