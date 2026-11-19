import { describe, expect, it } from "vitest";
import { formatSubagentWidget } from "../../pi-todos/src/todos.js";
import { subagentDisplayName } from "../src/state.js";

describe("subagent row identity", () => {
  it("labels rows with a stable role-index handle", () => {
    const first = subagentDisplayName({
      agent: "engineer",
      task: "Fix auth",
    });
    const second = subagentDisplayName({
      agent: "engineer",
      task: "Refactor cache",
    });

    expect(first).toMatch(/^@engineer-\d+$/);
    expect(second).toMatch(/^@engineer-\d+$/);
    expect(first).toBe(second);
  });

  it("keeps the label stable across model changes", () => {
    const label = subagentDisplayName({
      agent: "reviewer",
      task: "Review patch",
    });

    expect(
      subagentDisplayName({
        agent: "reviewer",
        model: "claude-sonnet-4",
        task: "Review patch",
      }),
    ).toBe(label);
  });

  it("each agent role gets its own handle", () => {
    const engineer = subagentDisplayName({ agent: "engineer", task: "a" });
    const reviewer = subagentDisplayName({ agent: "reviewer", task: "a" });

    expect(engineer).toMatch(/^@engineer-\d+$/);
    expect(reviewer).toMatch(/^@reviewer-\d+$/);
    expect(engineer).not.toBe(reviewer);
  });

  it("an empty role still yields a deterministic handle without throwing", () => {
    let label: string | undefined;
    expect(() => {
      label = subagentDisplayName({ agent: "", task: "" });
    }).not.toThrow();
    expect(label).toBe("@-1");
  });

  it("elapsed time survives a narrow subagent row", () => {
    const now = 1_000_000;
    const lines = formatSubagentWidget(
      [
        {
          id: "sub-9",
          state: "running",
          startedAt: now - 65_000,
          task: "a very long task description that will not fit in a narrow panel",
        },
      ],
      { now, width: 24 },
    );

    const rendered = (lines ?? []).join("\n");
    expect(rendered).toContain("01:05");
    expect(rendered).not.toContain("…");
  });
});
