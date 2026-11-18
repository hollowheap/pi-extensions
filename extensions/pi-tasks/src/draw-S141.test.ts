import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { TaskStore, spawnDetachedTask } from "./index.js";
import { readTaskLog, readTaskMetadata, taskLogPath } from "./registry.js";

describe("S141 reusable task primitives", () => {
  it("re-exports a working TaskStore and detached spawn", () => {
    const dir = mkdtempSync(`${tmpdir()}/s141-tasks-`);
    const store = new TaskStore(dir, "tasks");
    store.write({
      id: "task-1",
      status: "running",
      startedAt: 1,
    });

    expect(store.update("task-1", { status: "completed" })?.status).toBe(
      "completed",
    );
    expect(store.read("task-1")?.status).toBe("completed");
    expect(typeof spawnDetachedTask).toBe("function");
  });

  it("S141 C02: missing ids and logs return empty results", () => {
    const dir = mkdtempSync(`${tmpdir()}/s141-empty-`);
    const store = new TaskStore(dir, "tasks");
    expect(store.list()).toEqual([]);
    expect(store.read("absent")).toBeUndefined();
    expect(store.update("absent", { status: "completed" })).toBeUndefined();
    expect(store.log("absent")).toBe("");
  });

  it("S141 C03: a guarded update leaves state intact when its predicate fails", () => {
    const dir = mkdtempSync(`${tmpdir()}/s141-guard-`);
    const store = new TaskStore(dir, "tasks");
    store.write({ id: "task-2", status: "running", startedAt: 1 });

    const unchanged = store.updateIf(
      "task-2",
      (current) => current.status === "completed",
      { status: "completed" },
    );
    expect(unchanged?.status).toBe("running");
    expect(store.read("task-2")?.status).toBe("running");
  });

  it("S141 C04: store state and log paths are the ones the task registry reads", async () => {
    const dir = mkdtempSync(`${tmpdir()}/s141-shared-`);
    const store = new TaskStore(dir, "tasks");
    store.write({
      id: "task-3",
      kind: "shell",
      status: "running",
      cwd: "/repo",
      startedAt: 1,
    });
    store.ensureLog("task-3");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(store.logPath("task-3"), "shared log\n");

    expect(store.logPath("task-3")).toBe(taskLogPath(dir, "task-3"));
    expect(readTaskMetadata(dir, "task-3")?.id).toBe("task-3");
    expect(readTaskLog(dir, "task-3")).toBe("shared log\n");
  });
});
