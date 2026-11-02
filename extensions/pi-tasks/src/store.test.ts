import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessState } from "@hollowheap/process";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStore } from "./store.js";

const dirs: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("TaskStore", () => {
  it("stores tasks in a caller-selected subdirectory", () => {
    const dir = root();
    const store = new TaskStore<ProcessState>(dir, "custom");
    store.write({ id: "a", status: "running", startedAt: 1 });
    expect(store.read("a")).toMatchObject({ id: "a", status: "running" });
    expect(store.dir).toBe(join(dir, "custom"));
    expect(store.log("a")).toBe("");
  });

  it("updates atomically and refuses a stale patch", () => {
    const dir = root();
    const store = new TaskStore<ProcessState>(dir);
    store.write({ id: "a", status: "cancelled", startedAt: 1 });
    const current = store.updateIf("a", (state) => state.status === "running", {
      status: "completed",
    });
    expect(current?.status).toBe("cancelled");
    expect(store.read("a")?.status).toBe("cancelled");
    expect(existsSync(`${store.statePath("a")}.lock`)).toBe(false);
    store.update("a", { status: "failed", exitCode: 1 });
    expect(store.read("a")).toMatchObject({ status: "failed", exitCode: 1 });
  });
});
