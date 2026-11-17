import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "./todos.js";

describe("S177 todo widget width", () => {
  it("keeps every line within the configured width for long text", () => {
    const lines = formatTodoWidget(
      [{ id: 1, text: "A".repeat(150), done: false }],
      [],
      [],
      { width: 40 },
    );

    expect(lines).toBeDefined();
    for (const line of lines ?? []) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });
});
