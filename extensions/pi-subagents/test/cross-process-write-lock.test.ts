import { mkdirSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withWriteLock } from "../src/write-lock.js";

describe("cross-process per-tool write lock", () => {
  it("serializes writers and releases the lock after each operation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cross-process-write-lock-lock-"));
    const first = withWriteLock(dir, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "first";
    });
    const second = withWriteLock(dir, () => "second");
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    expect(await withWriteLock(dir, () => "after")).toBe("after");
  });

  it("an already-aborted signal rejects before acquiring", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cross-process-write-lock-lock-"));
    const controller = new AbortController();
    controller.abort();
    await expect(
      withWriteLock(dir, () => "value", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("releases the lock when the operation throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cross-process-write-lock-lock-"));
    await expect(
      withWriteLock(dir, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withWriteLock(dir, () => "after")).resolves.toBe("after");
  });

  it("reclaims an ownerless lock older than the grace period", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cross-process-write-lock-lock-"));
    const lockDir = join(dir, "subagents", "write.lock");
    mkdirSync(lockDir, { recursive: true });
    const old = new Date(Date.now() - 5_000);
    utimesSync(lockDir, old, old);
    await expect(
      withWriteLock(dir, () => "reclaimed", { timeoutMs: 500 }),
    ).resolves.toBe("reclaimed");
  });
});
