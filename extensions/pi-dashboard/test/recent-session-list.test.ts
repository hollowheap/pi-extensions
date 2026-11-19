import { describe, expect, it, vi } from "vitest";
import {
  clearSessionSummaryCache,
  loadRecentSessions,
} from "../src/sessions.js";

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
  it("collapses duplicate ids to the newest entry", async () => {
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

  it("an empty session list yields an empty result", async () => {
    clearSessionSummaryCache();
    const items = await loadRecentSessions({
      cwd: "/project",
      listSessions: vi.fn(async () => []),
      readFileText: vi.fn(async () => ""),
    });
    expect(items).toEqual([]);
  });

  it("a failing session listing degrades to an empty result", async () => {
    clearSessionSummaryCache();
    const items = await loadRecentSessions({
      cwd: "/project",
      listSessions: vi.fn(async () => {
        throw new Error("listing failed");
      }),
      readFileText: vi.fn(async () => ""),
    });
    expect(items).toEqual([]);
  });

  it("the all-workspaces scope uses the global listing", async () => {
    clearSessionSummaryCache();
    const local = vi.fn(async () => [info("local", new Date("2026-01-01"))]);
    const global = vi.fn(async () => [info("global", new Date("2026-01-02"))]);
    const items = await loadRecentSessions({
      cwd: "/project",
      scope: "all",
      listSessions: local,
      listAllSessions: global,
      readFileText: vi.fn(async () => ""),
    });
    expect(items.map((item) => item.id)).toEqual(["global"]);
    expect(global).toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
  });
});
