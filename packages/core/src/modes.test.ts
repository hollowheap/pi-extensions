import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enterMode,
  evaluate,
  getModeLayer,
  modeNames,
  registerMode,
  registerModeGate,
  replaceConfigModes,
} from "./modes.js";
import { dropSession, session, setCwd, setMode } from "./state.js";
import type { Effect, Rule, Tag } from "./types.js";

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
};

function rule(effect: Effect, tag: Tag, pattern: string): Rule {
  return { effect, tag, pattern };
}

function evaluateAs(
  mode: string,
  tag: Tag,
  target: string,
  rules: Rule[] = [],
  cwd = "/work",
): Effect {
  const owner = {};
  setMode(owner, mode);
  const verdict = evaluate({ owner, cwd, tag, target, rules });
  dropSession(owner);
  return verdict;
}

afterEach(() => {
  replaceConfigModes([]);
});

describe("built-in modes", () => {
  it("matches the ask, edit, and plan matrix", () => {
    expect(getModeLayer("ask")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "ask",
      shell: "ask",
    });
    expect(getModeLayer("edit")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "allow",
      shell: "ask",
    });
    expect(getModeLayer("plan")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "deny",
      shell: "ask",
    });

    expect(evaluateAs("ask", "edit", "src/a.ts")).toBe("ask");
    expect(evaluateAs("ask", "shell", "ls")).toBe("ask");
    expect(evaluateAs("ask", "read", "src/a.ts")).toBe("allow");

    expect(evaluateAs("edit", "edit", "src/a.ts")).toBe("allow");
    expect(evaluateAs("edit", "shell", "ls")).toBe("ask");

    expect(evaluateAs("plan", "read", "src/a.ts")).toBe("allow");
    expect(evaluateAs("plan", "edit", "src/a.ts")).toBe("deny");
    expect(evaluateAs("plan", "shell", "ls")).toBe("ask");
  });

  it("asks on plan artifacts in plan mode", () => {
    expect(evaluateAs("plan", "edit", "artifacts/plan.md")).toBe("ask");
    expect(evaluateAs("plan", "edit", "artifacts/specs.md")).toBe("ask");
    expect(evaluateAs("edit", "edit", "artifacts/plan.md")).toBe("allow");
  });

  it("denies other edits in plan mode even when the project allows them", () => {
    const rules = [rule("allow", "edit", "*")];
    expect(evaluateAs("plan", "edit", "src/a.ts", rules)).toBe("deny");
    expect(evaluateAs("plan", "edit", "artifacts/plan.md", rules)).toBe("ask");
  });

  it("denies plan-mode edits outside the effective cwd", () => {
    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    const rules = [rule("allow", "edit", "*")];
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "/work/src/a.ts",
        rules,
      }),
    ).toBe("deny");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "/work/sub/artifacts/plan.md",
        rules,
      }),
    ).toBe("ask");
    dropSession(owner);
  });

  it("resolves plan artifacts against the effective cwd", () => {
    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "/work/sub/artifacts/plan.md",
        rules: [],
      }),
    ).toBe("ask");
    dropSession(owner);
  });

  it("keeps a project ask rule when the layer default allows", () => {
    const owner = {};
    setMode(owner, "loose");
    setCwd(owner, "/work/sub");
    replaceConfigModes([
      {
        name: "loose",
        defaults: {
          read: "allow",
          search: "allow",
          edit: "allow",
          shell: "ask",
        },
        overrides: [{ tag: "edit", pattern: "docs/**", effect: "ask" }],
      },
    ]);
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "/work/src/a.ts",
        rules: [rule("ask", "edit", "src/**")],
      }),
    ).toBe("ask");
    dropSession(owner);
  });

  it("allows everything in autopilot except hard safety and denies", () => {
    replaceConfigModes([{ name: "autopilot", defaults: ALLOW }]);
    expect(evaluateAs("autopilot", "edit", "src/a.ts")).toBe("allow");
    expect(evaluateAs("autopilot", "edit", "artifacts/plan.md")).toBe("allow");
    expect(evaluateAs("autopilot", "shell", "git status && ls")).toBe("allow");
    expect(evaluateAs("autopilot", "shell", "bash -c 'echo hi'")).toBe("deny");
    expect(evaluateAs("autopilot", "shell", "echo $(date)")).toBe("deny");
    expect(evaluateAs("autopilot", "edit", "../outside.ts")).toBe("deny");
    expect(
      evaluateAs("autopilot", "shell", "rm -rf build", [
        rule("deny", "shell", "rm"),
      ]),
    ).toBe("deny");
  });
});

describe("mode overrides", () => {
  it("applies shell mode overrides", () => {
    replaceConfigModes([
      {
        name: "no-rm",
        defaults: ALLOW,
        overrides: [rule("deny", "shell", "rm")],
      },
    ]);
    expect(evaluateAs("no-rm", "shell", "git status && rm build")).toBe("deny");
  });
});

describe("mode registry", () => {
  it("registers layers first-wins with a diagnostic", () => {
    const diagnostics: string[] = [];
    expect(
      registerMode({ name: "ask", defaults: ALLOW }, (message) =>
        diagnostics.push(message),
      ),
    ).toBe(false);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("already registered");
    expect(getModeLayer("ask")?.defaults.edit).toBe("ask");
  });

  it("runs entry gates in order, keeps the first veto, and collects every notice", () => {
    const name = "gated-test";
    registerMode({ name, defaults: ALLOW });
    const calls: string[] = [];
    const stopA = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("a");
      return { notice: { text: "a", level: "info" } };
    });
    const stopB = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("b");
      return { veto: "blocked" };
    });
    const stopC = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("c");
      return { notice: { text: "c", level: "info" } };
    });
    const stopD = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("d");
      return { veto: "also blocked" };
    });

    const owner = {};
    const result = enterMode(owner, name);
    expect(calls).toEqual(["a", "b", "c", "d"]);
    expect(result.mode).toBe("ask");
    expect(result.veto).toBe("blocked");
    expect(result.notices).toEqual([
      { text: "a", level: "info" },
      { text: "c", level: "info" },
    ]);
    expect(session(owner).mode).toBe("ask");

    stopA();
    stopB();
    stopC();
    stopD();
    dropSession(owner);
  });

  it("replaces a keyed gate instead of stacking it", () => {
    const name = "keyed-test";
    registerMode({ name, defaults: ALLOW });
    const calls: string[] = [];
    const stopFirst = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("first");
      return undefined;
    }, "reloadable");
    const stopSecond = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("second");
      return undefined;
    }, "reloadable");

    const owner = {};
    enterMode(owner, name);
    expect(calls).toEqual(["second"]);

    stopFirst();
    stopSecond();
    dropSession(owner);
  });

  it("runs a layer onEnter gate and returns its notice", () => {
    registerMode({
      name: "notice-test",
      defaults: ALLOW,
      onEnter: () => ({
        notice: { text: "hello", level: "warning" },
      }),
    });
    const owner = {};
    const result = enterMode(owner, "notice-test");
    expect(result.mode).toBe("notice-test");
    expect(result.notices).toEqual([{ text: "hello", level: "warning" }]);
    dropSession(owner);
  });

  it("reports unknown modes without changing state", () => {
    const owner = {};
    setMode(owner, "edit");
    const result = enterMode(owner, "missing");
    expect(result.diagnostic).toContain("unknown mode");
    expect(session(owner).mode).toBe("edit");
    dropSession(owner);
  });

  it("replaces config layers wholesale and rejects collisions", () => {
    replaceConfigModes([{ name: "readonly", defaults: ALLOW }]);
    expect(modeNames()).toContain("readonly");
    replaceConfigModes([{ name: "other", defaults: ALLOW }]);
    expect(modeNames()).not.toContain("readonly");
    expect(modeNames()).toContain("other");

    const diagnostics: string[] = [];
    replaceConfigModes([{ name: "plan", defaults: ALLOW }], (message) =>
      diagnostics.push(message),
    );
    expect(diagnostics[0]).toContain("already registered");
    expect(getModeLayer("plan")?.defaults.edit).toBe("deny");
  });

  it("shares the layer registry across module instances", async () => {
    replaceConfigModes([{ name: "shared-layer", defaults: ALLOW }]);
    vi.resetModules();
    const fresh = await import("./modes.js");
    expect(fresh.modeNames()).toContain("shared-layer");
    fresh.replaceConfigModes([]);
    expect(modeNames()).not.toContain("shared-layer");
  });
});
