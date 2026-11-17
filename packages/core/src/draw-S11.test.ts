import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { evaluate, registerMode } from "./modes.js";
import { dropSession, setCwd, setMode } from "./state.js";
import type { Rule } from "./types.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function evaluateInPlan(target: string, rules: Rule[], cwd = "/work") {
  const owner = {};
  setMode(owner, "plan");
  const verdict = evaluate({ owner, cwd, tag: "edit", target, rules });
  dropSession(owner);
  return verdict;
}

describe("S11: plan mode edit paths", () => {
  it("asks on plan and spec artifacts, denies other edits, and honors a deny", () => {
    const allow: Rule[] = [{ tag: "edit", pattern: "*", effect: "allow" }];
    expect(evaluateInPlan("artifacts/plan.md", allow)).toBe("ask");
    expect(evaluateInPlan("artifacts/specs.md", allow)).toBe("ask");
    expect(evaluateInPlan("src/a.ts", allow)).toBe("deny");

    const deny: Rule[] = [
      { tag: "edit", pattern: "artifacts/**", effect: "deny" },
    ];
    expect(evaluateInPlan("artifacts/plan.md", deny)).toBe("deny");

    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "/work/sub/artifacts/plan.md",
        rules: allow,
      }),
    ).toBe("ask");
    dropSession(owner);
  });
});
