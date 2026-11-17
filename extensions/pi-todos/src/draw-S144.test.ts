import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "./todos.js";

describe("S144 todo widget ordering", () => {
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
});
