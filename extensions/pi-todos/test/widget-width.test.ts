import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { formatSubagentWidget, formatTodoWidget } from "../src/todos.js";

describe("todo widget width", () => {
  it("keeps every line within the configured width for long text", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "A".repeat(150), done: false }],
      [],
      [],
      { width: 40 },
    );

    expect(lines).toBeDefined();
    for (const line of lines ?? []) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("CJK todo text is bounded at a narrow width", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "任务".repeat(40), done: false }],
      [],
      [],
      { width: 20 },
    );

    expect(lines).toBeDefined();
    for (const line of lines ?? []) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  it("emoji todo text is bounded at a wide width", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "🚀".repeat(60), done: false }],
      [],
      [],
      { width: 80 },
    );

    expect(lines).toBeDefined();
    for (const line of lines ?? []) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  it("adjacent subagent widgets also fit the configured width", () => {
    const lines = formatSubagentWidget(
      [
        {
          id: "sub-1",
          agent: "scout",
          state: "running",
          task: "T".repeat(120),
          startedAt: 1_000,
          activeTool: "read",
          activeToolStartedAt: 500,
        },
      ],
      { width: 30, now: 2_000 },
    );

    expect(lines).toBeDefined();
    for (const line of lines ?? []) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(30);
    }
  });
});
