import { describe, expect, it, vi } from "vitest";
import { clearSessionSummaryCache, loadRecentSessions } from "./sessions.js";

function info(id: string, modified: Date) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/project",
    created: modified,
    modified,
    messageCount: 3,
    firstMessage: `session ${id}`,
    allMessagesText: "",
  };
}

describe("dashboard recent-session list", () => {
  it("S206 C01: collapses duplicate ids to the newest entry", async () => {
    clearSessionSummaryCache();
    const older = new Date("2026-01-01T10:00:00Z");
    const newer = new Date("2026-01-01T12:00:00Z");
    const listSessions = vi.fn(async () => [
      info("dup", older),
      info("other", older),
      info("dup", newer),
    ]);

    const items = await loadRecentSessions({
      cwd: "/project",
      listSessions,
      readFileText: vi.fn(async () => ""),
    });

    expect(items.map((item) => item.id)).toEqual(["dup", "other"]);
    expect(items[0]?.modified).toEqual(newer);
  });
});
