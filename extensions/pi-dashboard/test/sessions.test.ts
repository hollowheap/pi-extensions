import { describe, expect, it, vi } from "vitest";
import {
  clearSessionSummaryCache,
  formatRelativeAge,
  loadRecentSessions,
  sessionDisplayTitle,
} from "../src/sessions.js";

describe("formatRelativeAge", () => {
  it("formats seconds, minutes, hours, days, and months", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeAge(now - 20_000, now)).toBe("now");
    expect(formatRelativeAge(now - 5 * 60_000, now)).toBe("5m");
    expect(formatRelativeAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatRelativeAge(now - 4 * 86_400_000, now)).toBe("4d");
    expect(formatRelativeAge(now - 65 * 86_400_000, now)).toBe("2mo");
  });
});

describe("sessionDisplayTitle", () => {
  it("prefers explicit name, then sanitized first message, then session id", () => {
    expect(
      sessionDisplayTitle({
        id: "abcdef12",
        name: "My Session",
        firstMessage: "ignored",
      }),
    ).toBe("My Session");
    expect(
      sessionDisplayTitle({
        id: "abcdef12",
        firstMessage: "fix\x1b[31m color\n\tbug",
      }),
    ).toBe("fix color bug");
    expect(sessionDisplayTitle({ id: "abcdef1234", firstMessage: "" })).toBe(
      "session abcdef12",
    );
  });
});

describe("loadRecentSessions", () => {
  it("filters empty/current sessions, sorts newest first, extracts summary, and caches reads", async () => {
    clearSessionSummaryCache();
    const t1 = new Date("2026-01-01T10:00:00Z");
    const t2 = new Date("2026-01-01T12:00:00Z");

    const readFileText = vi.fn(async (path: string) => {
      if (path === "/s/2.jsonl") {
        return [
          JSON.stringify({ type: "session", id: "s2", cwd: "/proj" }),
          JSON.stringify({
            type: "custom",
            id: "c1",
            parentId: null,
            timestamp: "2026-01-01T12:00:00Z",
            customType: "hollowheap.agent",
            data: { name: "scout" },
          }),
          JSON.stringify({
            type: "custom",
            id: "c2",
            parentId: "c1",
            timestamp: "2026-01-01T12:00:01Z",
            customType: "hollowheap.todos",
            data: { todos: [{ id: 1, text: "ship it", done: false }] },
          }),
        ].join("\n");
      }
      throw new Error("missing");
    });

    const listSessions = vi.fn(async () => [
      {
        id: "current",
        path: "/s/cur.jsonl",
        cwd: "/proj",
        created: t2,
        modified: t2,
        messageCount: 5,
        firstMessage: "current",
        allMessagesText: "",
      },
      {
        id: "empty",
        path: "/s/empty.jsonl",
        cwd: "/proj",
        created: t2,
        modified: t2,
        messageCount: 0,
        firstMessage: "",
        allMessagesText: "",
      },
      {
        id: "s1",
        path: "/s/1.jsonl",
        cwd: "/proj",
        created: t1,
        modified: t1,
        messageCount: 3,
        firstMessage: "older session",
        allMessagesText: "",
      },
      {
        id: "s2",
        path: "/s/2.jsonl",
        cwd: "/proj",
        created: t2,
        modified: t2,
        messageCount: 8,
        firstMessage: "newer session",
        allMessagesText: "",
      },
    ]);

    const first = await loadRecentSessions({
      cwd: "/proj",
      currentSessionId: "current",
      listSessions,
      readFileText,
    });
    expect(first.map((item) => item.id)).toEqual(["s2", "s1"]);
    expect(first[0]?.summary).toEqual({
      agent: "scout",
      todosOpen: 1,
      todosTotal: 1,
    });
    expect(first[1]?.summary).toEqual({});

    // Second read with identical modified timestamp hits cache for s2; failed s1 retries cleanly.
    await loadRecentSessions({
      cwd: "/proj",
      currentSessionId: "current",
      listSessions,
      readFileText,
    });
    expect(readFileText).toHaveBeenCalledTimes(3);
    expect(readFileText).toHaveBeenLastCalledWith("/s/1.jsonl");
  });
});
