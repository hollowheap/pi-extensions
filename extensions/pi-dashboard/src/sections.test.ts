import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_ACTIONS,
  renderActionsSection,
  renderSessionsSection,
  renderStateSection,
} from "./sections.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("renderStateSection", () => {
  it("renders live snapshot state inside target width without leaking control chars", () => {
    const lines = renderStateSection(
      {
        cwd: "/work/my-pi-agent",
        model: "claude-sonnet-4-5",
        thinking: "high",
        snapshot: {
          mode: { name: "plan", updatedAt: 1 },
          agent: { name: "worker\x1b]0;evil\x07", updatedAt: 1 },
          autopilot: { active: true, updatedAt: 1 },
          guard: {
            trusted: true,
            decisionCount: 4,
            activeGrantCount: 1,
            approvedTagsCount: 0,
            deniedCount: 1,
            updatedAt: 1,
          },
          usage: {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 1500,
            totalCost: 0.42,
            budgetCap: 1.0,
            budgetWarning: true,
            updatedAt: 1,
          },
          todos: {
            total: 2,
            open: 1,
            done: 1,
            highPriority: 1,
            items: [
              { id: 1, text: "done task", done: true },
              {
                id: 2,
                text: "finish dashboard",
                done: false,
                priority: "high",
              },
            ],
            updatedAt: 1,
          },
          tasks: { running: 1, total: 2, recent: [], updatedAt: 1 },
          subagents: {
            running: 1,
            total: 1,
            sessionDefinitions: [],
            items: [],
            updatedAt: 1,
          },
          memory: {
            observations: 4,
            reflections: 1,
            unconsumed: 0,
            updatedAt: 1,
          },
          lsp: {
            servers: [{ name: "typescript", status: "ready" }],
            requestCount: 3,
            updatedAt: 1,
          },
        },
      },
      theme,
      80,
    );

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(80);
      expect(line).not.toContain("\x1b]");
    }
    const text = lines.join("\n");
    expect(text).toContain("my-pi-agent");
    expect(text).toContain("plan");
    expect(text).toContain("@worker");
    expect(text).toContain("autopilot");
    expect(text).toContain("trusted (1 denied)");
    expect(text).toContain("1.5k tok");
    expect(text).toContain("$0.42/$1.00!");
    expect(text).toContain("finish dashboard");
    expect(text).toContain("tasks 1/2 run");
    expect(text).toContain("mem 4obs/1ref");
    expect(text).toContain("lsp typescript");
  });
});

describe("renderSessionsSection", () => {
  it("renders empty placeholder or numbered session rows within width", () => {
    const empty = renderSessionsSection([], theme, 60);
    expect(empty.join("\n")).toContain("No previous sessions in this project");

    const now = new Date("2026-01-01T12:00:00Z").getTime();
    const lines = renderSessionsSection(
      [
        {
          id: "s1",
          path: "/s1.jsonl",
          cwd: "/repo",
          created: new Date(now - 7_200_000),
          modified: new Date(now - 3_600_000),
          messageCount: 12,
          firstMessage: "refactor statusline",
          summary: { agent: "scout", todosOpen: 3, totalCost: 0.15 },
        },
      ],
      theme,
      72,
      { selectedIndex: 0, now, showHint: true },
    );

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(72);
    }
    expect(lines[1]).toContain("▶");
    expect(lines[1]).toContain("refactor statusline");
    expect(lines[1]).toContain("1h");
    expect(lines[1]).toContain("12m");
    expect(lines[1]).toContain("3 todo");
  });
});

describe("renderActionsSection", () => {
  it("wraps quick action commands cleanly inside width", () => {
    const lines = renderActionsSection(DEFAULT_DASHBOARD_ACTIONS, theme, 50);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(50);
    }
    expect(lines.join("\n")).toContain("/todos");
  });
});
