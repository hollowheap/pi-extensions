import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { TaskStore, spawnDetachedTask } from "./index.js";

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
});
