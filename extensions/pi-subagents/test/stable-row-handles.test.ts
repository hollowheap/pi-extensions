import { describe, expect, it } from "vitest";
import { formatSubagentWidget } from "../../pi-todos/src/todos.js";
import { subagentDisplayName } from "../src/state.js";

describe("subagent row identity", () => {
  it("numbers rows by role in start order", () => {
    const roster = [
      { id: "sub-a", agent: "engineer", startedAt: 2 },
      { id: "sub-b", agent: "engineer", startedAt: 1 },
    ];
    const first = subagentDisplayName(
      { id: "sub-b", agent: "engineer", task: "Fix auth", startedAt: 1 },
      roster,
    );
    const second = subagentDisplayName(
      {
        id: "sub-a",
        agent: "engineer",
        task: "Refactor cache",
        startedAt: 2,
      },
      roster,
    );

    expect(first).toBe("@engineer-1");
    expect(second).toBe("@engineer-2");
  });

  it("keeps the label stable across model changes", () => {
    const roster = [{ id: "sub-r", agent: "reviewer", startedAt: 1 }];
    const label = subagentDisplayName(
      { id: "sub-r", agent: "reviewer", task: "Review patch", startedAt: 1 },
      roster,
    );

    expect(
      subagentDisplayName(
        {
          id: "sub-r",
          agent: "reviewer",
          model: "claude-sonnet-4",
          task: "Review patch",
          startedAt: 1,
        },
        roster,
      ),
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
