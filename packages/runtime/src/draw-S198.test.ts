import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cancelProcessGroup,
  isProcessAlive,
  readLog,
  spawnDetachedProcess,
} from "./process.js";
import * as processModule from "./process.js";

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "s198-runtime-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function readChildPid(logPath: string): Promise<number> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const parsed = Number.parseInt(readLog(logPath).trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("grandchild pid was not recorded");
}

describe("S198 descendant group teardown primitive", () => {
  it("tears down the shim group and the inner command group in one path", async () => {
    const rawTerminateProcessGroups = (
      processModule as unknown as Record<string, unknown>
    ).terminateProcessGroups;
    expect(rawTerminateProcessGroups).toBeTypeOf("function");
    const terminateProcessGroups = rawTerminateProcessGroups as (
      groups: Array<{ pid: number; startTime?: number }>,
      opts: { graceMs: number },
    ) => Promise<boolean>;

    const dir = makeDir();
    const shimLog = join(dir, "shim.log");
    const innerLog = join(dir, "inner.log");
    const shim = spawnDetachedProcess({
      command: "sh",
      args: ["-c", "sleep 60 & echo $!; wait"],
      logPath: shimLog,
    });
    const inner = spawnDetachedProcess({
      command: "sleep",
      args: ["60"],
      logPath: innerLog,
    });
    const grandchild = await readChildPid(shimLog);

    try {
      await expect(
        terminateProcessGroups(
          [
            { pid: shim.pid, startTime: shim.startTime },
            { pid: inner.pid, startTime: inner.startTime },
          ],
          { graceMs: 100 },
        ),
      ).resolves.toBe(true);

      expect(isProcessAlive(shim.pid, shim.startTime)).toBe(false);
      expect(isProcessAlive(inner.pid, inner.startTime)).toBe(false);
      expect(isProcessAlive(grandchild)).toBe(false);
    } finally {
      await cancelProcessGroup(shim.pid, shim.startTime, 50);
      await cancelProcessGroup(inner.pid, inner.startTime, 50);
      try {
        process.kill(grandchild, "SIGKILL");
      } catch {
        // already dead
      }
    }
  });
});
