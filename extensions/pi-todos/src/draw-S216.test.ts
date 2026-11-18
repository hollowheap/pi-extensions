import { describe, expect, it } from "vitest";
import {
  type TaskStateItem,
  formatSubagentWidget,
  formatTaskWidget,
  formatTodoWidget,
} from "./todos.js";

const todos = [{ id: 1, text: "Write specs", done: false }];
const subagents = [
  {
    id: "sub-1",
    agent: "scout",
    state: "running",
    startedAt: Date.now() - 5000,
  },
];
const tasks: TaskStateItem[] = [
  { id: "task-1", status: "running", command: "npm test" },
];

describe("S216 separate widget ownership", () => {
  it("keeps subagent and task rows out of the todos widget", () => {
    const lines = formatTodoWidget(todos, subagents, tasks, {
      now: Date.now(),
    });

    expect(lines).toBeDefined();
    const rendered = (lines ?? []).join("\n");
    expect(rendered).toContain("Write specs");
    expect(rendered).not.toContain("Subagents (");
    expect(rendered).not.toContain("Tasks (");
    expect(rendered).not.toContain("@sub-1");
    expect(rendered).not.toContain("task-1");
  });

  it("does not build a composite split panel in a wide widget", () => {
    const lines = formatTodoWidget(todos, subagents, tasks, {
      width: 120,
      now: Date.now(),
    });

    const rendered = (lines ?? []).join("\n");
    expect(rendered).toContain("Todos (");
    expect(rendered).not.toContain("Subagents (");
    expect(rendered).not.toContain("Tasks (");
    expect(rendered).not.toMatch(/│.*[│├┤]/);
  });

  it("S216 C02: an empty todo source renders no todo widget", () => {
    expect(formatTodoWidget([], subagents, tasks, { now: Date.now() })).toBeUndefined();
    expect(formatTodoWidget(todos, subagents, tasks, { collapsed: true })).toBeUndefined();
  });

  it("S216 C03: each widget renders only its own rows", () => {
    const now = 1_000_000;
    const subLines =
      formatSubagentWidget(
        [{ ...subagents[0], startedAt: now - 9_000 }],
        { now },
      ) ?? [];
    const taskLines = formatTaskWidget(tasks, { now }) ?? [];

    const subRendered = subLines.join("\n");
    const taskRendered = taskLines.join("\n");
    expect(subRendered).toContain("Subagents (1 active)");
    expect(subRendered).toContain("@sub-1");
    expect(subRendered).toContain("00:09");
    expect(subRendered).not.toContain("task-1");
    expect(taskRendered).toContain("Tasks (1 running)");
    expect(taskRendered).toContain("task-1");
    expect(taskRendered).toContain("npm test");
    expect(taskRendered).not.toContain("@sub-1");
  });

  it("S216 C04: removing the subagent source leaves the other widgets intact", () => {
    expect(formatSubagentWidget([], { now: Date.now() })).toBeUndefined();

    const todoLines = formatTodoWidget(todos, [], tasks, { now: Date.now() }) ?? [];
    const taskLines = formatTaskWidget(tasks, { now: Date.now() }) ?? [];
    expect(todoLines.join("\n")).toContain("Write specs");
    expect(taskLines.join("\n")).toContain("task-1");
  });
});
