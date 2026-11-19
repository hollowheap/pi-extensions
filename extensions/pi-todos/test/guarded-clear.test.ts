import { describe, expect, it } from "vitest";
import { applyTodoCommand, formatTodoList } from "../src/todos.js";

describe("guarded delete_todos", () => {
  it("refuses to clear a list with open items and clears only when all are done", () => {
    const open = { todos: [{ id: 1, text: "a", done: false }], nextId: 2 };
    const rejected = applyTodoCommand(open, { type: "delete" });
    expect(rejected.changed).toBe(false);
    expect(rejected.state.todos).toHaveLength(1);

    const done = { todos: [{ id: 1, text: "a", done: true }], nextId: 2 };
    const accepted = applyTodoCommand(done, { type: "delete" });
    expect(accepted.changed).toBe(true);
    expect(accepted.state.todos).toEqual([]);
  });

  it("delete on an empty list is a no-op that preserves nextId", () => {
    const empty = { todos: [], nextId: 3 };
    const result = applyTodoCommand(empty, { type: "delete" });
    expect(result.changed).toBe(false);
    expect(result.unknownIds).toEqual([]);
    expect(result.state.todos).toEqual([]);
    expect(result.state.nextId).toBe(3);
  });

  it("unknown completion ids are reported without throwing or mutating", () => {
    const state = { todos: [{ id: 1, text: "a", done: false }], nextId: 2 };
    const result = applyTodoCommand(state, {
      type: "complete",
      ids: [7, 7, 9],
    });
    expect(result.unknownIds).toEqual([7, 9]);
    expect(result.changed).toBe(false);
    expect(result.state.todos).toEqual(state.todos);
    expect(result.state.todos[0]?.done).toBe(false);
  });

  it("deleting one id flows into the rendered todo list", () => {
    const state = {
      todos: [
        { id: 1, text: "keep", done: false },
        { id: 2, text: "remove", done: false },
      ],
      nextId: 3,
    };
    const result = applyTodoCommand(state, { type: "delete", ids: [2] });
    expect(result.unknownIds).toEqual([]);
    expect(formatTodoList(result.state.todos)).toBe("• 1 keep");
  });
});
