import { describe, expect, it } from "vitest";
import {
  applyTodoCommand,
  emptyTodoState,
  formatTodoList,
} from "./todos.js";

describe("S123 edit, priority, bulk complete", () => {
  it("renames, sorts by priority, and completes every todo", () => {
    let state = applyTodoCommand(emptyTodoState(), {
      type: "create",
      texts: ["first", "second"],
    }).state;
    state = applyTodoCommand(state, { type: "edit", id: 1, text: "renamed" })
      .state;
    state = applyTodoCommand(state, {
      type: "priority",
      id: 2,
      priority: "high",
    }).state;
    expect(formatTodoList(state.todos).split("\n")[0]).toContain("second");

    state = applyTodoCommand(state, { type: "complete", ids: [1, 2] }).state;
    expect(state.todos.every((todo) => todo.done)).toBe(true);
  });
});
