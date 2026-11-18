import { describe, expect, it } from "vitest";
import { formatTodoConfirmation, formatTodoList } from "./todos.js";

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

describe("priority, sanitization, and confirmation seams", () => {
  it("S57 C02: priority sorts before id and is rendered as a prefix", () => {
    expect(
      formatTodoList([
        { id: 2, text: "Low", done: false, priority: "low" },
        { id: 1, text: "High", done: false, priority: "high" },
      ]),
    ).toBe("• 1 [high] High\n• 2 [low] Low");
  });

  it("S57 C03: terminal escape codes in task text are sanitized", () => {
    const rendered = formatTodoList([
      { id: 1, text: "\u001b[31mRed\u001b[0m", done: false },
    ]);
    expect(rendered).toContain("Red");
    expect(rendered).not.toContain("\u001b[31m");
  });

  it("S57 C04: confirmation lists unknown IDs sorted and deduplicated", () => {
    expect(
      formatTodoConfirmation([{ id: 1, text: "A", done: true }], [9, 3, 3]),
    ).toBe("Todos:\n✓ 1 A\nUnknown IDs: 3, 9");
  });
});
