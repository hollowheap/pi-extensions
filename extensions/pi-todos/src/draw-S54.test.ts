import { describe, expect, it } from "vitest";
import { applyTodoCommand, emptyTodoState } from "./todos.js";

describe("S54: create parses an ordered list into todos with stable IDs", () => {
  it("appends non-empty task texts in order with monotonic IDs", () => {
    const result = applyTodoCommand(emptyTodoState(), {
      type: "create",
      texts: ["First", "Second"],
    });
    expect(result.changed).toBe(true);
    expect(result.unknownIds).toEqual([]);
    expect(result.state).toEqual({
      todos: [
        { id: 1, text: "First", done: false },
        { id: 2, text: "Second", done: false },
      ],
      nextId: 3,
    });
  });
});
