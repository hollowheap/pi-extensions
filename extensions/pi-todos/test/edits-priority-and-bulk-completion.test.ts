import { describe, expect, it } from "vitest";
import {
  applyTodoCommand,
  emptyTodoState,
  formatTodoList,
} from "../src/todos.js";

describe("edit, priority, bulk complete", () => {
  it("renames, sorts by priority, and completes every todo", () => {
    let state = applyTodoCommand(emptyTodoState(), {
      type: "create",
      texts: ["first", "second"],
    }).state;
    state = applyTodoCommand(state, {
      type: "edit",
      id: 1,
      text: "renamed",
    }).state;
    state = applyTodoCommand(state, {
      type: "priority",
      id: 2,
      priority: "high",
    }).state;
    expect(formatTodoList(state.todos).split("\n")[0]).toContain("second");

    state = applyTodoCommand(state, { type: "complete", ids: [1, 2] }).state;
    expect(state.todos.every((todo) => todo.done)).toBe(true);
  });

  it("creating with no texts leaves state untouched", () => {
    const empty = emptyTodoState();
    const result = applyTodoCommand(empty, { type: "create", texts: [] });
    expect(result.changed).toBe(false);
    expect(result.state.todos).toEqual([]);
    expect(result.state.nextId).toBe(1);
  });

  it("editing an unknown id is reported instead of throwing", () => {
    const state = applyTodoCommand(emptyTodoState(), {
      type: "create",
      texts: ["only"],
    }).state;
    const result = applyTodoCommand(state, {
      type: "edit",
      id: 42,
      text: "missing",
    });
    expect(result.unknownIds).toEqual([42]);
    expect(result.changed).toBe(false);
    expect(result.state.todos[0]?.text).toBe("only");
  });

  it("priority tags and completion glyphs reach the formatted list", () => {
    let state = applyTodoCommand(emptyTodoState(), {
      type: "create",
      texts: ["t"],
    }).state;
    state = applyTodoCommand(state, {
      type: "priority",
      id: 1,
      priority: "high",
    }).state;
    state = applyTodoCommand(state, { type: "complete", ids: [1] }).state;
    expect(formatTodoList(state.todos)).toBe("✓ 1 [high] t");
  });
});
