import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { terminateBoth } = vi.hoisted(() => ({
  terminateBoth: vi.fn(async () => true),
}));

vi.mock("@hollowheap/runtime/process", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hollowheap/runtime/process")>();
  return {
    ...actual,
    cancelProcessGroup: vi.fn(async () => false),
    terminateProcessGroups: terminateBoth,
    isProcessAlive: vi.fn(() => false),
  };
});

import { readTaskMetadata, writeTaskMetadata } from "./registry.js";
import { cancelTask } from "./runner.js";

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "s199-tasks-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  terminateBoth.mockClear();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runningTask(dir: string, id: string): void {
  writeTaskMetadata(dir, {
    id,
    kind: "shell",
    status: "running",
    command: "sleep 60",
    cwd: dir,
    pid: 91_111,
    startTime: 1,
    innerPid: 92_222,
    innerStartTime: 2,
    startedAt: Date.now(),
  });
}

describe("S199 cancel teardown before reporting", () => {
  it("does not record cancelled while a group teardown reports survivors", async () => {
    const dir = makeDir();
    runningTask(dir, "t1");

    const result = await cancelTask(dir, "t1");

    expect(result?.status).not.toBe("cancelled");
    expect(readTaskMetadata(dir, "t1")?.status).toBe("running");
  });

  it("tears down both process groups through one shared escalation path", async () => {
    const dir = makeDir();
    runningTask(dir, "t2");

    await cancelTask(dir, "t2");

    expect(terminateBoth).toHaveBeenCalledWith(
      [
        { pid: 91_111, startTime: 1 },
        { pid: 92_222, startTime: 2 },
      ],
      expect.anything(),
    );
  });

  it("S199 C02: a running task without group identities is not torn down", async () => {
    const dir = makeDir();
    writeTaskMetadata(dir, {
      id: "no-groups",
      kind: "shell",
      status: "running",
      command: "sleep 60",
      cwd: dir,
      startedAt: Date.now(),
    });

    const result = await cancelTask(dir, "no-groups");

    expect(terminateBoth).not.toHaveBeenCalled();
    expect(result?.status).not.toBe("cancelled");
  });

  it("S199 C03: cancelling an already-finished task skips teardown", async () => {
    const dir = makeDir();
    writeTaskMetadata(dir, {
      id: "done",
      kind: "shell",
      status: "completed",
      command: "echo ok",
      cwd: dir,
      pid: 91_111,
      startTime: 1,
      startedAt: Date.now(),
    });

    await cancelTask(dir, "done");

    expect(terminateBoth).not.toHaveBeenCalled();
    expect(readTaskMetadata(dir, "done")?.status).toBe("completed");
  });

  it("S199 C04: cancelling an unknown id returns undefined", async () => {
    const dir = makeDir();
    await expect(cancelTask(dir, "missing")).resolves.toBeUndefined();
    expect(terminateBoth).not.toHaveBeenCalled();
  });
});
