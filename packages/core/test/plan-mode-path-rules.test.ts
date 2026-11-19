import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { evaluate, registerMode } from "../src/modes.js";
import { dropSession, setCwd, setMode } from "../src/state.js";
import type { Rule } from "../src/types.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function evaluateInPlan(target: string, rules: Rule[], cwd = "/work") {
  const owner = {};
  setMode(owner, "plan");
  const verdict = evaluate({ owner, cwd, tag: "edit", target, rules });
  dropSession(owner);
  return verdict;
}

describe("plan mode edit paths", () => {
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

describe("non-edit tags, outside-path refusal and decision consumer", () => {
  it("plan mode leaves read, search and shell defaults intact", () => {
    const owner = {};
    setMode(owner, "plan");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "read",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "search",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "shell",
        target: "echo hi",
        rules: [],
      }),
    ).toBe("ask");
    dropSession(owner);
  });

  it("an artifact-named path outside the cwd is still denied", () => {
    const allow: Rule[] = [{ tag: "edit", pattern: "**", effect: "allow" }];
    expect(evaluateInPlan("/outside/artifacts/plan.md", allow)).toBe("deny");
  });

  it("a persistent deny decision overrides the plan artifact ask", () => {
    const owner = {};
    setMode(owner, "plan");
    const persistentDecisions = new Map<string, "allow" | "ask" | "deny">([
      ["/work/artifacts/plan.md", "deny"],
    ]);
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "artifacts/plan.md",
        rules: [],
        persistentDecisions,
      }),
    ).toBe("deny");
    dropSession(owner);
  });
});
