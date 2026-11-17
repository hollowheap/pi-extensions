import { describe, expect, it } from "vitest";
import { formatTodoList } from "./todos.js";

describe("S57: the todo list shows every id with a done marker", () => {
  it("lists todos in ID order with open and done markers", () => {
    expect(
      formatTodoList([
        { id: 2, text: "Second", done: true },
        { id: 1, text: "First", done: false },
      ]),
    ).toBe("• 1 First\n✓ 2 Second");
    expect(formatTodoList([])).toBe("No todos");
  });
});
