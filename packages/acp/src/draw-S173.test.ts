import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadStore } from "./sessions.js";

describe("S173 corrupt session store", () => {
  it("returns an empty store and logs a diagnostic instead of exiting", () => {
    const dir = mkdtempSync(join(tmpdir(), "s173-acp-"));
    const path = join(dir, "sessions.json");
    writeFileSync(path, "{truncated", "utf8");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      expect(loadStore(path)).toEqual([]);
      const logged = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(logged).toContain(path);
    } finally {
      stderr.mockRestore();
    }
  });
});
