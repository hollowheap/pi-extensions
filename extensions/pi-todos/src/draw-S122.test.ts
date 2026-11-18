import { describe, expect, it } from "vitest";
import {
  formatSubagentWidget,
  formatTaskWidget,
  formatTodoWidget,
} from "./todos.js";

describe("S122 widget toggle and separate rows", () => {
  it("collapses to no lines and renders task/subagent rows with the same schema", () => {
    expect(
      formatTodoWidget([{ id: 1, text: "x", done: false }], [], [], {
        collapsed: true,
      }),
    ).toBeUndefined();
    expect(
      formatSubagentWidget([{ id: "s1", state: "running" }], {
        collapsed: true,
      }),
    ).toBeUndefined();
    expect(
      formatTaskWidget([{ id: "t1", status: "running" }], { collapsed: true }),
    ).toBeUndefined();

    const subagentText =
      formatSubagentWidget([{ id: "s1", state: "running", startedAt: 0 }], {
        now: 1_000,
      })?.join("\n") ?? "";
    const taskText =
      formatTaskWidget([{ id: "t1", status: "running", command: "ls" }])?.join(
        "\n",
      ) ?? "";
    expect(subagentText).toContain("@s1 00:01 ●");
    expect(taskText).toContain("t1 ●");
    expect(taskText).toContain("(ls)");
  });
});
