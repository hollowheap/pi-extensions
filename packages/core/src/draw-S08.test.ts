import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { evaluate, registerMode } from "./modes.js";
import { dropSession, setCwd, setMode } from "./state.js";
import type { Effect, Rule, Tag } from "./types.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function evaluateAs(
  mode: string,
  tag: Tag,
  target: string,
  rules: Rule[] = [],
): Effect {
  const owner = {};
  setMode(owner, mode);
  const verdict = evaluate({ owner, cwd: "/work", tag, target, rules });
  dropSession(owner);
  return verdict;
}

describe("S08: verdict precedence is order independent", () => {
  it("applies safety, deny, mode override, specificity and default in any shuffle", () => {
    expect(evaluateAs("edit", "edit", "../outside.ts")).toBe("deny");
    expect(evaluateAs("edit", "shell", "echo $(date)")).toBe("deny");
    expect(
      evaluateAs("plan", "edit", "artifacts/plan.md", [
        { tag: "edit", pattern: "artifacts/**", effect: "deny" },
      ]),
    ).toBe("deny");
    expect(
      evaluateAs("plan", "edit", "artifacts/plan.md", [
        { tag: "edit", pattern: "artifacts/**", effect: "allow" },
      ]),
    ).toBe("ask");

    const rules: Rule[] = [
      { tag: "edit", pattern: "src/*", effect: "allow" },
      { tag: "edit", pattern: "src/secret.ts", effect: "ask" },
      { tag: "edit", pattern: "src/*", effect: "ask" },
    ];
    const shuffles = [
      rules,
      [...rules].reverse(),
      [rules[2], rules[0], rules[1]],
    ];
    for (const shuffle of shuffles) {
      expect(evaluateAs("edit", "edit", "src/secret.ts", shuffle)).toBe("ask");
      expect(evaluateAs("edit", "edit", "src/a.ts", shuffle)).toBe("ask");
      expect(evaluateAs("ask", "edit", "src/a.ts", shuffle)).toBe("ask");
      expect(evaluateAs("edit", "edit", "src/a.ts", [])).toBe("allow");
    }
  });
});

describe("S08: mode defaults, hard-safety refusal and session-cwd consumer", () => {
  it("S08 C02: with no rules the verdict is the active mode's own default", () => {
    expect(evaluateAs("manual", "edit", "src/a.ts")).toBe("ask");
    expect(evaluateAs("manual", "read", "src/a.ts")).toBe("allow");
    expect(evaluateAs("plan", "read", "src/a.ts")).toBe("allow");
  });

  it("S08 C03: hard safety denies an outside path despite an allow rule", () => {
    const allow: Rule[] = [{ tag: "edit", pattern: "**", effect: "allow" }];
    expect(evaluateAs("edit", "edit", "../escape.ts", allow)).toBe("deny");
    const allowShell: Rule[] = [
      { tag: "shell", pattern: "rm", effect: "allow" },
    ];
    expect(evaluateAs("edit", "shell", "rm -rf /", allowShell)).toBe("ask");
  });

  it("S08 C04: the session cwd decides whether a plan override matches", () => {
    const withCwd = {};
    setMode(withCwd, "plan");
    setCwd(withCwd, "/work/sub");
    expect(
      evaluate({
        owner: withCwd,
        cwd: "/work",
        tag: "edit",
        target: "/work/sub/artifacts/plan.md",
        rules: [],
      }),
    ).toBe("ask");
    dropSession(withCwd);

    const withoutCwd = {};
    setMode(withoutCwd, "plan");
    expect(
      evaluate({
        owner: withoutCwd,
        cwd: "/work",
        tag: "edit",
        target: "/work/sub/artifacts/plan.md",
        rules: [],
      }),
    ).toBe("deny");
    dropSession(withoutCwd);
  });
});
