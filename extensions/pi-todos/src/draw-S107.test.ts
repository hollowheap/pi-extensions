import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "./todos.js";

describe("S107 sticky todo widget", () => {
  it("renders open todos in a widget rather than a statusline segment", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "write tests", done: false }],
      [],
      [],
    );
    expect(Array.isArray(lines)).toBe(true);
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("Todos");
    expect(text).toContain("write tests");
  });
});
