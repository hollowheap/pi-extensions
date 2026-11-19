import { describe, expect, it } from "vitest";
import { formatTodoList, formatTodoWidget } from "../src/todos.js";

describe("the widget shows open todos above the editor with an overflow hint", () => {
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

  it("renders completed todos with a done count and strikethrough", () => {
    const lines = formatTodoWidget(
      [
        { id: 1, text: "Open", done: false },
        { id: 2, text: "Done", done: true },
      ],
      [],
      [],
      { strikethrough: (text) => `~${text}~` },
    );
    expect(lines?.[0]).toBe("Todos (1 open, 1 ✓)");
    expect(lines?.join("\n")).toContain("• 1 Open");
    expect(lines?.join("\n")).toContain("✓ 2 ~Done~");
  });

  it("suppresses the widget entirely when collapsed", () => {
    const todos = [{ id: 1, text: "One", done: false }];
    expect(
      formatTodoWidget(todos, [], [], { collapsed: true }),
    ).toBeUndefined();
    expect(formatTodoWidget(todos, [], [], {})).toBeDefined();
  });

  it("orders widget rows by priority exactly as the list does", () => {
    const todos = [
      { id: 3, text: "Low", done: false, priority: "low" as const },
      { id: 1, text: "High", done: false, priority: "high" as const },
      { id: 2, text: "Medium", done: false, priority: "medium" as const },
    ];
    const widget = formatTodoWidget(todos)?.join("\n") ?? "";
    const list = formatTodoList(todos);
    expect(widget.indexOf("High")).toBeLessThan(widget.indexOf("Medium"));
    expect(widget.indexOf("Medium")).toBeLessThan(widget.indexOf("Low"));
    expect(list.indexOf("High")).toBeLessThan(list.indexOf("Medium"));
    expect(list.indexOf("Medium")).toBeLessThan(list.indexOf("Low"));
  });
});
