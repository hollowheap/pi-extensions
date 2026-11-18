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

describe("idempotence, empty, and field-preservation seams", () => {
  it("S55 C02: completing an already-done todo is not a change", () => {
    const result = applyTodoCommand(
      { todos: [{ id: 1, text: "A", done: true }], nextId: 2 },
      { type: "complete", ids: [1] },
    );
    expect(result.changed).toBe(false);
    expect(result.unknownIds).toEqual([]);
  });

  it("S55 C03: completing with no ids changes nothing", () => {
    const state = { todos: [{ id: 1, text: "A", done: false }], nextId: 2 };
    const result = applyTodoCommand(state, { type: "complete", ids: [] });
    expect(result.changed).toBe(false);
    expect(result.state).toEqual(state);
  });

  it("S55 C04: completing a todo preserves its priority field", () => {
    const result = applyTodoCommand(
      {
        todos: [{ id: 1, text: "A", done: false, priority: "high" }],
        nextId: 2,
      },
      { type: "complete", ids: [1] },
    );
    expect(result.state.todos[0]).toEqual({
      id: 1,
      text: "A",
      done: true,
      priority: "high",
    });
  });
});
