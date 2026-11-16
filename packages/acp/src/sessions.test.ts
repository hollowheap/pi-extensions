import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadStore, saveStore } from "./sessions.js";

describe("sessions store", () => {
  it("logs a diagnostic with the file path and returns an empty store when sessions.json does not parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-acp-sessions-"));
    const path = join(dir, "sessions.json");
    writeFileSync(path, "{truncated", "utf8");
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      expect(loadStore(path)).toEqual([]);
      expect(stderrSpy).toHaveBeenCalled();
      const logged = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(logged).toContain(path);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("writes sessions atomically and round-trips records", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-acp-sessions-"));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "sessions.json");
    const records = [
      {
        sessionId: "s-1",
        cwd: "/repo",
        piSessionFile: "/repo/s-1.jsonl",
        title: "Test",
        updatedAt: "2026-01-01T00:00:00.000Z",
        agent: "hollowheap-pi-acp" as const,
      },
    ];
    saveStore(path, records);
    expect(loadStore(path)).toEqual(records);
    expect(readFileSync(path, "utf8")).toContain('"sessionId": "s-1"');
  });
});
