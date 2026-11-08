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

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-runtime-proc-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("cancelProcessGroup", () => {
  it("returns false when neither leader nor process group exists", async () => {
    await expect(cancelProcessGroup(999_999_999, undefined, 50)).resolves.toBe(
      false,
    );
  });

  it("signals remaining group members after the leader has exited", async () => {
    const dir = makeTempDir();
    const logPath = join(dir, "task.log");
    const proc = spawnDetachedProcess({
      command: "sh",
      args: ["-c", "sleep 60 & echo $!; exit 0"],
      logPath,
    });

    let childPid = 0;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const text = readLog(logPath).trim();
      const parsed = Number.parseInt(text, 10);
      if (Number.isInteger(parsed) && parsed > 0 && !isProcessAlive(proc.pid)) {
        childPid = parsed;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(childPid).toBeGreaterThan(0);
    expect(isProcessAlive(proc.pid, proc.startTime)).toBe(false);
    expect(isProcessAlive(childPid)).toBe(true);

    try {
      await expect(
        cancelProcessGroup(proc.pid, proc.startTime, 250),
      ).resolves.toBe(true);
      expect(isProcessAlive(childPid)).toBe(false);
    } finally {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // already dead
      }
    }
  });
});
