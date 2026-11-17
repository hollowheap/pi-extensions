import { describe, expect, it } from "vitest";
import { applyTodoCommand } from "./todos.js";

describe("S55: complete marks known IDs once and reports unknowns", () => {
  it("applies positive IDs idempotently and reports unknown IDs once", () => {
    const initial = {
      todos: [
        { id: 1, text: "First", done: false },
        { id: 2, text: "Second", done: false },
      ],
      nextId: 3,
    };
    const result = applyTodoCommand(initial, {
      type: "complete",
      ids: [1, 1, 9, 9],
    });
    expect(result.changed).toBe(true);
    expect(result.unknownIds).toEqual([9]);
    expect(result.state.todos).toEqual([
      { id: 1, text: "First", done: true },
      { id: 2, text: "Second", done: false },
    ]);
    expect(initial.todos[0].done).toBe(false);
  });
});
