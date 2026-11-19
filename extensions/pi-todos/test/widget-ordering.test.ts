import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "../src/todos.js";

describe("todo widget ordering", () => {
  it("shows open work before completed work", () => {
    const lines = formatTodoWidget([
      { id: 1, text: "Done", done: true },
      { id: 2, text: "Open", done: false },
    ]);

    expect(lines?.some((line) => line.includes("• 2 Open"))).toBe(true);
    expect(lines?.findIndex((line) => line.includes("• 2 Open"))).toBeLessThan(
      lines?.findIndex((line) => line.includes("Done")) ?? 0,
    );
  });

  it("collapsed and empty inputs produce no widget", () => {
    const todos = [{ id: 1, text: "a", done: false }];
    expect(
      formatTodoWidget(todos, [], [], { collapsed: true }),
    ).toBeUndefined();
    expect(formatTodoWidget([], [], [], {})).toBeUndefined();
  });

  it("rows beyond ten are replaced by an overflow hint", () => {
    const todos = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      text: `Task ${index + 1}`,
      done: false,
    }));
    const lines = formatTodoWidget(todos) ?? [];
    expect(lines[0]).toBe("Todos (12 open)");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe("+2 more (/todos)");
    expect(lines.join("\n")).not.toContain("Task 11");
  });

  it("the options signature applies strikethrough and priority order", () => {
    const lines = formatTodoWidget(
      [
        { id: 2, text: "Late", done: true, priority: "low" as const },
        { id: 3, text: "Urgent", done: false, priority: "high" as const },
        { id: 1, text: "Open", done: false, priority: "medium" as const },
      ],
      [],
      [],
      { strikethrough: (text) => `~${text}~` },
    );
    expect(lines?.[0]).toBe("Todos (2 open, 1 ✓)");
    expect(lines?.slice(1).map((line) => line.trim())).toEqual([
      "• 3 Urgent",
      "• 1 Open",
      "✓ 2 ~Late~",
    ]);
  });
});
