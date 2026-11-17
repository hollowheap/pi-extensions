import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "./todos.js";

describe("S62: the widget shows open todos above the editor with an overflow hint", () => {
  it("omits completed rows when only done todos remain and adds an overflow hint", () => {
    expect(formatTodoWidget([])).toBeUndefined();
    const one = formatTodoWidget([{ id: 1, text: "One", done: false }]);
    expect(one?.join("\n")).toContain("• 1 One");

    const many = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      text: `Task ${i + 1}`,
      done: false,
    }));
    const widget = formatTodoWidget(many)?.join("\n") ?? "";
    expect(widget).toContain("Task 1");
    expect(widget).toContain("+2 more (/todos)");
    expect(widget).not.toContain("Task 11");
  });
});
