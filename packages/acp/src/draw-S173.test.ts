import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadStore, saveStore } from "./sessions.js";

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

  it("S173 C02: a missing store file is silently treated as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "s173-acp-"));
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      expect(loadStore(join(dir, "absent.json"))).toEqual([]);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it("S173 C03: valid records are loaded while malformed rows are filtered out", () => {
    const dir = mkdtempSync(join(tmpdir(), "s173-acp-"));
    const path = join(dir, "sessions.json");
    writeFileSync(
      path,
      JSON.stringify([
        {
          sessionId: "s1",
          cwd: "/repo",
          piSessionFile: "/repo/s1.jsonl",
          title: "First",
        },
        { sessionId: "s2", cwd: "/repo" },
        "not-an-object",
      ]),
    );

    const records = loadStore(path);

    expect(records).toHaveLength(1);
    expect(records[0]?.sessionId).toBe("s1");
    expect(records[0]?.title).toBe("First");
  });

  it("S173 C04: saveStore replaces the store atomically and loadStore reads it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "s173-acp-"));
    const path = join(dir, "nested", "sessions.json");
    const record = {
      sessionId: "s9",
      cwd: "/repo",
      piSessionFile: "/repo/s9.jsonl",
      title: "Round trip",
      updatedAt: "2026-01-01T00:00:00.000Z",
      agent: "hollowheap-pi-acp" as const,
    };

    saveStore(path, [record]);

    expect(loadStore(path)).toEqual([record]);
    expect(readdirSync(join(dir, "nested"))).toEqual(["sessions.json"]);
  });
});
