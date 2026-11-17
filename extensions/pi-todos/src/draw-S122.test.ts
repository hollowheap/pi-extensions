import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "./todos.js";

describe("S122 panel toggle and symmetric rows", () => {
  it("collapses to no lines and renders task/subagent rows with the same schema", () => {
    expect(
      formatTodoWidget([{ id: 1, text: "x", done: false }], [], [], {
        collapsed: true,
      }),
    ).toBeUndefined();

    const lines = formatTodoWidget(
      [],
      [{ id: "s1", state: "running", startedAt: 0 }],
      [{ id: "t1", status: "running", command: "ls" }],
      { now: 1_000 },
    );
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("@s1 00:01 ●");
    expect(text).toContain("t1 ●");
    expect(text).toContain("(ls)");
  });
});
