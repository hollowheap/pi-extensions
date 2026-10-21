import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type SessionRecord, loadStore, saveStore } from "./sessions.js";

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "s1",
    cwd: "/repo",
    piSessionFile: "/sessions/s1.jsonl",
    title: "hello",
    updatedAt: "2026-10-15T00:00:00.000Z",
    agent: "hollowheap-pi-acp",
    ...overrides,
  };
}

describe("session store", () => {
  it("returns empty for a missing file", () => {
    expect(loadStore(join(tmpdir(), "pi-acp-nope", "s.json"))).toEqual([]);
  });

  it("round-trips records through save and load", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-acp-store-"));
    const path = join(dir, "sessions.json");
    saveStore(path, [record(), record({ sessionId: "s2" })]);
    expect(loadStore(path)).toHaveLength(2);
    expect(loadStore(path)[0]).toEqual(record());
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  });

  it("drops malformed entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-acp-store-"));
    const path = join(dir, "sessions.json");
    saveStore(path, [record(), { nope: true } as unknown as SessionRecord]);
    expect(loadStore(path)).toEqual([record()]);
  });
});
