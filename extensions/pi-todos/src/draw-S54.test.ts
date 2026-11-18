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

describe("empty, immutability, and continuation seams", () => {
  it("S54 C02: creating with no texts is a no-op", () => {
    const before = emptyTodoState();
    const result = applyTodoCommand(before, { type: "create", texts: [] });
    expect(result.changed).toBe(false);
    expect(result.state).toEqual(before);
  });

  it("S54 C03: create returns a new state without mutating the input", () => {
    const before = {
      todos: [{ id: 1, text: "A", done: false }],
      nextId: 2,
    };
    const result = applyTodoCommand(before, {
      type: "create",
      texts: ["B"],
    });
    expect(before.todos).toEqual([{ id: 1, text: "A", done: false }]);
    expect(before.nextId).toBe(2);
    expect(result.state.todos).not.toBe(before.todos);
    expect(result.state.todos[1]).toEqual({ id: 2, text: "B", done: false });
  });

  it("S54 C04: creation continues numbering from a restored nextId", () => {
    const result = applyTodoCommand(
      { todos: [{ id: 4, text: "Old", done: true }], nextId: 5 },
      { type: "create", texts: ["New"] },
    );
    expect(result.state.todos[1].id).toBe(5);
    expect(result.state.nextId).toBe(6);
  });
});
