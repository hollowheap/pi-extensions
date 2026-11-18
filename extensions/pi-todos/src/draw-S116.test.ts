import { describe, expect, it } from "vitest";
import { formatSubagentWidget } from "./todos.js";

describe("S116 active tool duration in subagent rows", () => {
  it("renders elapsed time and the active tool duration on a subagent row", () => {
    const lines = formatSubagentWidget(
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
      { now: 7_000 },
    );
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("@s1");
    expect(text).toContain("00:06");
    expect(text).toContain("read 3s");
  });

  it("S116 C02: empty and collapsed widgets return no lines", () => {
    expect(formatSubagentWidget([])).toBeUndefined();
    expect(
      formatSubagentWidget([{ id: "s1", state: "running", startedAt: 1 }], {
        collapsed: true,
      }),
    ).toBeUndefined();
  });

  it("S116 C03: negative elapsed and tool durations clamp to zero", () => {
    const lines = formatSubagentWidget(
      [
        {
          id: "s1",
          state: "running",
          startedAt: 1_000,
          activeTool: "read",
          activeToolStartedAt: 2_000,
        },
      ],
      { now: 500 },
    );
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("00:00");
    expect(text).toContain("read 0s");
  });

  it("S116 C04: state icons and long task truncation are applied", () => {
    const lines = formatSubagentWidget(
      [
        { id: "s1", task: "x".repeat(30), state: "blocked", startedAt: 1_000 },
        { id: "s2", task: "short", state: "complete", startedAt: 1_000 },
      ],
      { now: 1_000 },
    );
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("Subagents (2 active)");
    expect(text).toContain("⏸");
    expect(text).toContain("✓");
    expect(text).toContain("…");
  });
});
