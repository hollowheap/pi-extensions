import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { evaluate, registerMode } from "./modes.js";
import { dropSession, setMode } from "./state.js";
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
