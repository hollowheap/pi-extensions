import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTaskRecord,
  taskLogPath,
  taskMetaPath,
  tasksDir,
} from "./registry.js";

describe("S69: the task registry persists durable records with tight permissions", () => {
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
});
