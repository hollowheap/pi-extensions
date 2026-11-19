import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  formatSubagentWidget,
  formatTaskWidget,
  formatTodoWidget,
} from "../src/todos.js";

describe("widget toggle and separate rows", () => {
  it("collapses to no lines and renders task/subagent rows with the same schema", () => {
    expect(
      formatTodoWidget([{ id: 1, text: "x", done: false }], [], [], {
        collapsed: true,
      }),
    ).toBeUndefined();
    expect(
      formatSubagentWidget([{ id: "s1", state: "running" }], {
        collapsed: true,
      }),
    ).toBeUndefined();
    expect(
      formatTaskWidget([{ id: "t1", status: "running" }], { collapsed: true }),
    ).toBeUndefined();

    const subagentText =
      formatSubagentWidget([{ id: "s1", state: "running", startedAt: 0 }], {
        now: 1_000,
      })?.join("\n") ?? "";
    const taskText =
      formatTaskWidget([{ id: "t1", status: "running", command: "ls" }])?.join(
        "\n",
      ) ?? "";
    expect(subagentText).toContain("@s1 00:01 ●");
    expect(taskText).toContain("t1 ●");
    expect(taskText).toContain("(ls)");
  });

  it("empty sources and finished-only tasks render no widget", () => {
    expect(formatTodoWidget([], [], [])).toBeUndefined();
    expect(formatSubagentWidget([])).toBeUndefined();
    expect(formatTaskWidget([])).toBeUndefined();
    expect(
      formatTaskWidget([{ id: "t1", status: "completed", command: "ls" }]),
    ).toBeUndefined();
  });

  it("a future start time clamps elapsed time to zero", () => {
    const lines = formatSubagentWidget(
      [{ id: "s1", state: "running", startedAt: 5_000 }],
      { now: 1_000 },
    );
    expect(lines?.[0]).toBe("Subagents (1 active)");
    expect(lines?.[1]).toBe("@s1 00:00 ●");
  });

  it("the width option truncates rows for the consuming renderer", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "x".repeat(120), done: false }],
      [],
      [],
      { width: 12 },
    );
    expect(lines).toBeDefined();
    for (const line of lines ?? []) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    }
    expect(visibleWidth(lines?.[1] ?? "")).toBe(12);
  });
});
