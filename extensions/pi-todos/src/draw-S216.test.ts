import { describe, expect, it } from "vitest";
import { type TaskStateItem, formatTodoWidget } from "./todos.js";

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
});
