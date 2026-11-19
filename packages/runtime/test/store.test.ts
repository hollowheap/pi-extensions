import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessState } from "@hollowheap/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { LockedProcessStore } from "../src/store.js";

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

describe("LockedProcessStore", () => {
  it("stores tasks in a caller-selected subdirectory", () => {
    const dir = root();
    const store = new LockedProcessStore<ProcessState>(dir, "custom");
    store.write({ id: "a", status: "running", startedAt: 1 });
    expect(store.read("a")).toMatchObject({ id: "a", status: "running" });
    expect(store.dir).toBe(join(dir, "custom"));
    expect(store.log("a")).toBe("");
  });

  it("updates atomically and refuses a stale patch", () => {
    const dir = root();
    const store = new LockedProcessStore<ProcessState>(dir);
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

  it("serializes writes through the state lock", () => {
    const dir = root();
    const store = new LockedProcessStore<ProcessState>(dir);
    store.write({ id: "a", status: "running", startedAt: 1 });
    const lockPath = `${store.statePath("a")}.lock`;
    writeFileSync(lockPath, "", { mode: 0o600 });
    try {
      expect(() =>
        store.write({ id: "a", status: "completed", startedAt: 2 }),
      ).toThrow(/timed out acquiring task state lock/);
      expect(store.read("a")?.status).toBe("running");
    } finally {
      rmSync(lockPath, { force: true });
    }
  });
});
