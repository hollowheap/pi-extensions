import { describe, expect, it } from "vitest";
import { applyTodoCommand, formatTodoWidget } from "../src/todos.js";

describe("sticky todo widget", () => {
  it("renders open todos in a widget rather than a statusline segment", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "write tests", done: false }],
      [],
      [],
    );
    expect(Array.isArray(lines)).toBe(true);
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("Todos");
    expect(text).toContain("write tests");
  });

  it("empty and collapsed widgets return no lines", () => {
    expect(formatTodoWidget([], [], [])).toBeUndefined();
    expect(
      formatTodoWidget([{ id: 1, text: "x", done: false }], [], [], {
        collapsed: true,
      }),
    ).toBeUndefined();
  });

  it("a delete without ids refuses while any todo is incomplete", () => {
    const state = {
      todos: [
        { id: 1, text: "a", done: true },
        { id: 2, text: "b", done: false },
      ],
      nextId: 3,
    };
    const blocked = applyTodoCommand(state, { type: "delete" });
    expect(blocked.changed).toBe(false);
    expect(blocked.state.todos).toHaveLength(2);

    const cleared = applyTodoCommand(
      { ...state, todos: [state.todos[0]] },
      { type: "delete" },
    );
    expect(cleared.changed).toBe(true);
    expect(cleared.state.todos).toHaveLength(0);
  });

  it("mixed headers, priority order, and an overflow marker are rendered", () => {
    const todos = [
      { id: 1, text: "low", done: false, priority: "low" as const },
      { id: 2, text: "high", done: false, priority: "high" as const },
      { id: 3, text: "done", done: true },
    ];
    const lines = formatTodoWidget(todos) ?? [];
    const text = lines.join("\n");
    expect(lines[0]).toBe("Todos (2 open, 1 ✓)");
    expect(text.indexOf("high")).toBeLessThan(text.indexOf("low"));
    expect(text).toContain("✓ 3");

    const many = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      text: `t${index + 1}`,
      done: false,
    }));
    expect((formatTodoWidget(many) ?? []).join("\n")).toContain(
      "+1 more (/todos)",
    );
  });
});
