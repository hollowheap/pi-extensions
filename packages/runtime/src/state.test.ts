import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessStore } from "./index.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hollowheap-state-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ProcessStore", () => {
  it("writes and reads atomic state with restrictive permissions", () => {
    const dir = tempDir();
    const store = new ProcessStore(dir);
    const state = {
      id: "job-1",
      status: "running",
      pid: 123,
      startTime: 456,
      startedAt: 100,
      extra: "value",
    };
    store.write(state);

    expect(store.read("job-1")).toEqual(state);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(store.statePath("job-1")).mode & 0o777).toBe(0o600);
    expect(store.ensureLog("job-1")).toBe(store.logPath("job-1"));
    expect(statSync(store.logPath("job-1")).mode & 0o777).toBe(0o600);
  });

  it("lists states in start order and updates them", () => {
    const dir = tempDir();
    const store = new ProcessStore(dir);
    store.write({ id: "b", status: "running", startedAt: 200 });
    store.write({ id: "a", status: "running", startedAt: 100 });

    expect(store.list().map((state) => state.id)).toEqual(["a", "b"]);
    expect(store.update("a", { status: "completed", exitCode: 0 })).toEqual({
      id: "a",
      status: "completed",
      startedAt: 100,
      exitCode: 0,
    });
    expect(store.read("missing")).toBeUndefined();
  });

  it("ignores corrupt state and rejects invalid ids", () => {
    const dir = tempDir();
    const store = new ProcessStore(dir);
    writeFileSync(join(dir, "bad.json"), "{", { mode: 0o600 });
    expect(store.read("bad")).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(store.read("../escape")).toBeUndefined();
    expect(() =>
      store.write({ id: "../escape", status: "running", startedAt: 1 }),
    ).toThrow(/Invalid process id/);
  });

  it("creates missing paths", () => {
    const dir = join(tempDir(), "nested");
    const store = new ProcessStore(dir);
    expect(existsSync(dir)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
