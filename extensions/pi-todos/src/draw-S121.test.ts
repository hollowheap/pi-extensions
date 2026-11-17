import { describe, expect, it } from "vitest";
import { applyTodoCommand } from "./todos.js";

describe("S121 guarded delete_todos", () => {
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
});
