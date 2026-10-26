import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cancelProcessGroup,
  isProcessAlive,
  readLog,
  readProcStartTime,
  spawnDetachedProcess,
  waitForProcessExit,
} from "./index.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hollowheap-process-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("process lifecycle", () => {
  it("spawns detached, appends logs, and observes exit", async () => {
    const dir = tempDir();
    const logPath = join(dir, "child.log");
    const spawned = spawnDetachedProcess({
      command: process.execPath,
      args: ["-e", "console.log('out'); console.error('err'); process.exit(3)"],
      logPath,
    });

    expect(spawned.pid).toBeGreaterThan(0);
    expect(spawned.startTime).toBe(readProcStartTime(spawned.pid));
    await once(spawned.child, "exit");
    expect(
      await waitForProcessExit(spawned.pid, spawned.startTime, {
        timeoutMs: 1_000,
      }),
    ).toBe(true);
    expect(isProcessAlive(spawned.pid, spawned.startTime)).toBe(false);
    expect(readLog(logPath)).toContain("out");
    expect(readLog(logPath)).toContain("err");
    expect(existsSync(logPath)).toBe(true);
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(logPath, "utf8")).toContain("out");
  });

  it("cancels a detached process group", async () => {
    const dir = tempDir();
    const logPath = join(dir, "child.log");
    const spawned = spawnDetachedProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      logPath,
    });
    const exited = once(spawned.child, "exit");

    expect(isProcessAlive(spawned.pid, spawned.startTime)).toBe(true);
    await expect(
      cancelProcessGroup(spawned.pid, spawned.startTime, 100),
    ).resolves.toBe(true);
    await exited;
    expect(isProcessAlive(spawned.pid, spawned.startTime)).toBe(false);
  });

  it("rejects invalid PIDs", () => {
    expect(isProcessAlive(undefined)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(readProcStartTime(0)).toBeUndefined();
  });
});
