import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withWriteLock } from "./write-lock.js";

describe("S98 cross-process per-tool write lock", () => {
  it("serializes writers and releases the lock after each operation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s98-lock-"));
    const first = withWriteLock(dir, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "first";
    });
    const second = withWriteLock(dir, () => "second");
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    expect(await withWriteLock(dir, () => "after")).toBe("after");
  });
});
