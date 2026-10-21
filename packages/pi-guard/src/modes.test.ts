import type { Tag, Verdict } from "@hollowheap/core";
import { describe, expect, it } from "vitest";
import {
  applyPolicy,
  builtinModes,
  clearCwdOverride,
  clearMode,
  effectiveCwd,
  getCwdOverride,
  getMode,
  isPlanPath,
  planRules,
  setCwdOverride,
  setMode,
} from "./modes.js";

function decided(
  mode: string,
  tag: Tag,
  verdict: Verdict,
  inPlanPaths = false,
) {
  return applyPolicy(builtinModes(), mode, tag, verdict, { inPlanPaths });
}

describe("builtin mode policies", () => {
  it("lists plan, ask, edit in order", () => {
    expect(builtinModes().map((entry) => entry.name)).toEqual([
      "plan",
      "ask",
      "edit",
    ]);
  });

  it("lets deny beat builtin modes and asks for plan files", () => {
    for (const mode of ["plan", "ask", "edit"]) {
      expect(decided(mode, "edit", "deny")).toBe("deny");
      expect(decided(mode, "shell", "deny")).toBe("deny");
      expect(decided(mode, "read", "deny")).toBe("deny");
      expect(decided(mode, "edit", "allow", true)).toBe("ask");
    }
  });

  it("passes verdicts through for unknown modes", () => {
    expect(decided("nope", "edit", "ask")).toBe("ask");
  });

  it("passes verdicts through in ask", () => {
    expect(decided("ask", "edit", "allow")).toBe("allow");
    expect(decided("ask", "edit", "ask")).toBe("ask");
    expect(decided("ask", "read", "ask")).toBe("ask");
    expect(decided("ask", "shell", "allow")).toBe("allow");
    expect(decided("ask", "shell", "ask")).toBe("ask");
  });

  it("runs reads and edits but gates shell in edit", () => {
    expect(decided("edit", "edit", "allow")).toBe("allow");
    expect(decided("edit", "edit", "ask")).toBe("allow");
    expect(decided("edit", "read", "ask")).toBe("allow");
    expect(decided("edit", "shell", "allow")).toBe("allow");
    expect(decided("edit", "shell", "ask")).toBe("deny");
  });

  it("confines plan mode to reads and allowlisted shell", () => {
    expect(decided("plan", "edit", "allow")).toBe("deny");
    expect(decided("plan", "edit", "ask")).toBe("deny");
    expect(decided("plan", "read", "allow")).toBe("allow");
    expect(decided("plan", "read", "ask")).toBe("ask");
    expect(decided("plan", "shell", "allow")).toBe("allow");
    expect(decided("plan", "shell", "ask")).toBe("deny");
  });
});

describe("mode state", () => {
  it("starts in ask and resets on clear", () => {
    const owner = {};
    expect(getMode(owner)).toBe("ask");
    setMode(owner, "plan");
    expect(getMode(owner)).toBe("plan");
    clearMode(owner);
    expect(getMode(owner)).toBe("ask");
  });
});

describe("cwd override", () => {
  it("returns the project root without an override", () => {
    const owner = {};
    expect(effectiveCwd("/root", owner)).toBe("/root");
    expect(getCwdOverride(owner)).toBeUndefined();
  });

  it("returns the override and clears it", () => {
    const owner = {};
    setCwdOverride(owner, "/root/sub");
    expect(effectiveCwd("/root", owner)).toBe("/root/sub");
    expect(getCwdOverride(owner)).toBe("/root/sub");
    setCwdOverride(owner, undefined);
    expect(effectiveCwd("/root", owner)).toBe("/root");
    clearCwdOverride(owner);
    expect(getCwdOverride(owner)).toBeUndefined();
  });
});

describe("plan paths", () => {
  it("builds plan rules for the plan files and tasks dir", () => {
    expect(planRules()).toEqual([
      { tag: "edit", pattern: "artifacts/plan.md", effect: "allow" },
      { tag: "edit", pattern: "artifacts/specs.md", effect: "allow" },
      { tag: "edit", pattern: "artifacts/tasks/*", effect: "allow" },
    ]);
  });

  it("detects plan paths from the project root", () => {
    expect(isPlanPath("artifacts/plan.md", "/root")).toBe(true);
    expect(isPlanPath("/root/artifacts/specs.md", "/root")).toBe(true);
    expect(isPlanPath("artifacts/tasks/a.md", "/root")).toBe(true);
    expect(isPlanPath("artifacts/tasks/deep/a.md", "/root")).toBe(true);
    expect(isPlanPath("artifacts/plans/a.md", "/root")).toBe(false);
    expect(isPlanPath("src/x.ts", "/root")).toBe(false);
    expect(isPlanPath("../plan.md", "/root")).toBe(false);
  });
});
