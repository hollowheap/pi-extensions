import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireWriteLock, withWriteLock } from "./write-lock.js";

const dirs: string[] = [];

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-lock-"));
  dirs.push(dir);
  return dir;
}

function lockPath(dir: string): string {
  return join(dir, "subagents", "write.lock");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("write lock", () => {
  it("acquires and releases one cross-process lock", async () => {
    const dir = agentDir();
    const release = await acquireWriteLock(dir);
    expect(statSync(lockPath(dir)).mode & 0o777).toBe(0o700);
    expect(statSync(join(lockPath(dir), "owner.json")).mode & 0o777).toBe(
      0o600,
    );
    release();
    expect(() => statSync(lockPath(dir))).toThrow();
  });

  it("serializes competing acquisitions", async () => {
    const dir = agentDir();
    const first = await acquireWriteLock(dir);
    let secondAcquired = false;
    const second = withWriteLock(dir, async () => {
      secondAcquired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(secondAcquired).toBe(false);
    first();
    await second;
    expect(secondAcquired).toBe(true);
  });

  it("times out while another owner holds the lock", async () => {
    const dir = agentDir();
    const first = await acquireWriteLock(dir);
    await expect(
      acquireWriteLock(dir, { timeoutMs: 50, pollMs: 10 }),
    ).rejects.toThrow(/timed out/);
    first();
  });

  it("reclaims a lock owned by a dead process", async () => {
    const dir = agentDir();
    mkdirSync(lockPath(dir), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(lockPath(dir), "owner.json"),
      `${JSON.stringify({ pid: 999999, createdAt: Date.now() })}\n`,
      { mode: 0o600 },
    );

    const release = await acquireWriteLock(dir, { timeoutMs: 500 });
    release();
  });

  it("aborts a waiting caller", async () => {
    const dir = agentDir();
    const first = await acquireWriteLock(dir);
    const controller = new AbortController();
    const waiting = acquireWriteLock(dir, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(waiting).rejects.toThrow(/abort/i);
    first();
  });
});
