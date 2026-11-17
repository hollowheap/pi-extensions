import { describe, expect, it } from "vitest";
import { formatTodoWidget } from "./todos.js";

describe("S116 active tool duration in subagent rows", () => {
  it("renders elapsed time and the active tool duration on a subagent row", () => {
    const lines = formatTodoWidget(
      [],
      [
        {
          id: "s1",
          task: "do thing",
          state: "running",
          startedAt: 1_000,
          activeTool: "read",
          activeToolStartedAt: 4_000,
        },
      ],
      [],
      { now: 7_000 },
    );
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("@s1");
    expect(text).toContain("00:06");
    expect(text).toContain("read 3s");
  });
});
