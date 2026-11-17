import { describe, expect, it } from "vitest";
import { subagentDisplayName } from "./state.js";

describe("S215 subagent row identity", () => {
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
});
