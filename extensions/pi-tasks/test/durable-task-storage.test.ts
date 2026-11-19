import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTaskRecord,
  ensureTasksDir,
  generateTaskId,
  listTaskMetadata,
  readTaskLog,
  readTaskMetadata,
  taskLogPath,
  taskMetaPath,
  tasksDir,
  writeTaskMetadata,
} from "../src/registry.js";

describe("the task registry persists durable records with tight permissions", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-draw-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("creates 0700 storage and 0600 metadata/log files", async () => {
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

    expect(statSync(tasksDir(agentDir)).mode & 0o777).toBe(0o700);
    expect(statSync(taskMetaPath(agentDir, "task-1")).mode & 0o777).toBe(0o600);
    expect(statSync(taskLogPath(agentDir, "task-1")).mode & 0o777).toBe(0o600);
    expect(record).toMatchObject({
      id: "task-1",
      kind: "shell",
      status: "running",
      command: "echo hello",
      cwd: "/repo",
    });
    expect("inbox" in record).toBe(false);
    expect("outbox" in record).toBe(false);

    writeFileSync(taskLogPath(agentDir, "task-1"), "hello\n", { mode: 0o600 });
    expect(await record.output()).toBe("hello\n");
  });

  it("generates unique task-prefixed identifiers", () => {
    const ids = Array.from({ length: 10 }, () => generateTaskId());
    for (const id of ids) expect(id).toMatch(/^task-/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores corrupt and schema-invalid metadata", () => {
    ensureTasksDir(agentDir);
    writeTaskMetadata(agentDir, {
      id: "valid",
      kind: "shell",
      status: "running",
      cwd: "/repo",
      startedAt: 1_000,
    });
    writeFileSync(taskMetaPath(agentDir, "corrupt"), "{not json");
    writeTaskMetadata(agentDir, {
      id: "wrong-shape",
      kind: "shell",
      status: "running",
      cwd: "/repo",
      startedAt: Number.NaN,
    } as never);
    expect(listTaskMetadata(agentDir).map((meta) => meta.id)).toEqual([
      "valid",
    ]);
    expect(readTaskMetadata(agentDir, "corrupt")).toBeUndefined();
    expect(readTaskMetadata(agentDir, "wrong-shape")).toBeUndefined();
  });

  it("round-trips metadata and reads the log behind a task id", () => {
    const meta = {
      id: "task-roundtrip",
      kind: "shell" as const,
      status: "completed" as const,
      cwd: "/repo",
      pid: 42,
      startedAt: 1_000,
      finishedAt: 2_000,
      exitCode: 0,
    };
    writeTaskMetadata(agentDir, meta);
    writeFileSync(taskLogPath(agentDir, meta.id), "line\n");
    expect(readTaskMetadata(agentDir, meta.id)).toEqual(meta);
    expect(readTaskLog(agentDir, meta.id)).toBe("line\n");
  });
});
