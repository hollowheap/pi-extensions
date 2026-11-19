import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnDetachedTask } from "../src/lifecycle.js";
import type { ProcessState } from "../src/state.js";
import { LockedProcessStore } from "../src/store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("spawnDetachedTask", () => {
  it("kills the spawned process and rethrows when persisting identity fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-runtime-lifecycle-"));
    dirs.push(dir);
    const store = new LockedProcessStore<ProcessState>(dir);
    const state: ProcessState = {
      id: "a",
      status: "running",
      startedAt: Date.now(),
    };
    vi.spyOn(store, "update").mockImplementationOnce(() => {
      throw new Error("state lock busy");
    });
    const killSpy = vi.spyOn(process, "kill");

    expect(() =>
      spawnDetachedTask({
        store,
        state,
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        cwd: dir,
        logPath: join(dir, "a.log"),
      }),
    ).toThrow(/state lock busy/);

    const groupKills = killSpy.mock.calls.filter(
      ([pid, signal]) =>
        typeof pid === "number" && pid < 0 && signal === "SIGKILL",
    );
    expect(groupKills.length).toBeGreaterThan(0);
    expect(store.read("a")?.status).toBe("failed");
  });
});
