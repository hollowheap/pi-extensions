import { describe, expect, it } from "vitest";
import {
  type Mode,
  applyMode,
  clearMode,
  getMode,
  getTokenCap,
  isMode,
  isPlanPath,
  planRules,
  setMode,
  setTokenCap,
} from "./modes.js";

const MODES: Mode[] = ["plan", "ask", "allow-edits", "autopilot"];

describe("applyMode", () => {
  it("lets deny beat every mode", () => {
    for (const mode of MODES) {
      expect(applyMode(mode, "edit", "deny", true)).toBe("deny");
      expect(applyMode(mode, "shell", "deny", false)).toBe("deny");
      expect(applyMode(mode, "read", "deny", false)).toBe("deny");
    }
  });

  it("always asks for plan files", () => {
    for (const mode of MODES) {
      expect(applyMode(mode, "edit", "allow", true)).toBe("ask");
    }
  });

  it("passes verdicts through in ask", () => {
    expect(applyMode("ask", "edit", "allow", false)).toBe("allow");
    expect(applyMode("ask", "edit", "ask", false)).toBe("ask");
    expect(applyMode("ask", "shell", "allow", false)).toBe("allow");
  });

  it("runs edits silently but still asks shell in allow-edits", () => {
    expect(applyMode("allow-edits", "edit", "allow", false)).toBe("allow");
    expect(applyMode("allow-edits", "edit", "ask", false)).toBe("ask");
    expect(applyMode("allow-edits", "shell", "allow", false)).toBe("ask");
    expect(applyMode("allow-edits", "shell", "ask", false)).toBe("ask");
  });

  it("runs edits and shell silently in autopilot", () => {
    expect(applyMode("autopilot", "edit", "allow", false)).toBe("allow");
    expect(applyMode("autopilot", "edit", "ask", false)).toBe("allow");
    expect(applyMode("autopilot", "shell", "allow", false)).toBe("allow");
    expect(applyMode("autopilot", "shell", "ask", false)).toBe("allow");
    expect(applyMode("autopilot", "read", "ask", false)).toBe("ask");
  });

  it("confines plan mode to plan paths with approval", () => {
    expect(applyMode("plan", "edit", "allow", false)).toBe("deny");
    expect(applyMode("plan", "edit", "ask", false)).toBe("deny");
    expect(applyMode("plan", "shell", "allow", false)).toBe("ask");
    expect(applyMode("plan", "shell", "ask", false)).toBe("deny");
    expect(applyMode("plan", "read", "allow", false)).toBe("allow");
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
    expect(getTokenCap(owner)).toBeUndefined();
  });

  it("stores a token cap per session", () => {
    const owner = {};
    expect(getTokenCap(owner)).toBeUndefined();
    setTokenCap(owner, 5000);
    expect(getTokenCap(owner)).toBe(5000);
    clearMode(owner);
    expect(getTokenCap(owner)).toBeUndefined();
  });

  it("recognizes mode names", () => {
    expect(isMode("plan")).toBe(true);
    expect(isMode("autopilot")).toBe(true);
    expect(isMode("turbo")).toBe(false);
  });

  it("builds plan rules for the plan files", () => {
    expect(planRules()).toEqual([
      { tag: "edit", pattern: "artifacts/plan.md", effect: "allow" },
      { tag: "edit", pattern: "artifacts/specs.md", effect: "allow" },
    ]);
  });

  it("detects plan paths from the project root", () => {
    expect(isPlanPath("artifacts/plan.md", "/root")).toBe(true);
    expect(isPlanPath("/root/artifacts/specs.md", "/root")).toBe(true);
    expect(isPlanPath("src/x.ts", "/root")).toBe(false);
    expect(isPlanPath("../plan.md", "/root")).toBe(false);
  });
});
