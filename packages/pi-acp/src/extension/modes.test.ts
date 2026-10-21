import { describe, expect, it } from "vitest";
import { type Mode, decide, isPlanPath } from "./modes.js";
import type { Tag, Verdict } from "./rules.js";

const MODES: Mode[] = ["plan", "ask", "edit"];

function decided(mode: Mode, tag: Tag, verdict: Verdict, inPlan = false) {
  return decide(mode, tag, verdict, inPlan);
}

describe("acp mode policy", () => {
  it("lets deny beat everything", () => {
    for (const mode of MODES) {
      expect(decided(mode, "edit", "deny")).toBe("deny");
      expect(decided(mode, "read", "deny")).toBe("deny");
      expect(decided(mode, "shell", "deny")).toBe("deny");
      expect(decided(mode, "search", "deny")).toBe("deny");
    }
  });

  it("auto-runs reads except unruled reads in plan and ask", () => {
    for (const mode of MODES) {
      expect(decided(mode, "read", "allow")).toBe("allow");
      expect(decided(mode, "search", "allow")).toBe("allow");
    }
    expect(decided("plan", "read", "ask")).toBe("ask");
    expect(decided("ask", "read", "ask")).toBe("ask");
    expect(decided("edit", "read", "ask")).toBe("allow");
  });

  it("always asks writes to plan paths", () => {
    for (const mode of MODES) {
      expect(decided(mode, "edit", "allow", true)).toBe("ask");
      expect(decided(mode, "edit", "ask", true)).toBe("ask");
    }
  });

  it("limits plan writes to plan paths", () => {
    expect(decided("plan", "edit", "allow", false)).toBe("deny");
    expect(decided("plan", "edit", "ask", false)).toBe("deny");
  });

  it("passes write and shell verdicts through in ask", () => {
    expect(decided("ask", "edit", "allow")).toBe("allow");
    expect(decided("ask", "edit", "ask")).toBe("ask");
    expect(decided("ask", "shell", "allow")).toBe("allow");
    expect(decided("ask", "shell", "ask")).toBe("ask");
  });

  it("auto-runs writes and allowlisted shell in edit", () => {
    expect(decided("edit", "edit", "allow")).toBe("allow");
    expect(decided("edit", "edit", "ask")).toBe("allow");
    expect(decided("edit", "shell", "allow")).toBe("allow");
    expect(decided("edit", "shell", "ask")).toBe("deny");
  });

  it("detects plan paths", () => {
    expect(isPlanPath("artifacts/plan.md", "/root")).toBe(true);
    expect(isPlanPath("artifacts/specs.md", "/root")).toBe(true);
    expect(isPlanPath("artifacts/tasks/a.md", "/root")).toBe(true);
    expect(isPlanPath("artifacts/plans/a.md", "/root")).toBe(false);
    expect(isPlanPath("src/x.ts", "/root")).toBe(false);
  });
});
