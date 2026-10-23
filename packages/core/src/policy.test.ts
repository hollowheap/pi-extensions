import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate } from "./modes.js";
import { checkPath, matchPath } from "./policy.js";
import { dropSession, setMode } from "./state.js";
import type { Effect, Rule, Tag } from "./types.js";

const ROOT = "/root";

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

describe("checkPath", () => {
  it("returns the highest-specificity allow/ask rule regardless of order", () => {
    const askBroad = { tag: "edit", pattern: "*.ts", effect: "ask" } as const;
    const allowNarrow = {
      tag: "edit",
      pattern: "src/*.ts",
      effect: "allow",
    } as const;
    expect(checkPath([askBroad, allowNarrow], "src/a.ts", "edit", ROOT)).toBe(
      "allow",
    );
    expect(checkPath([allowNarrow, askBroad], "src/a.ts", "edit", ROOT)).toBe(
      "allow",
    );

    const allowBroad = { tag: "edit", pattern: "*", effect: "allow" } as const;
    const askNarrow = { tag: "edit", pattern: "src/*", effect: "ask" } as const;
    expect(checkPath([allowBroad, askNarrow], "src/a.ts", "edit", ROOT)).toBe(
      "ask",
    );
    expect(checkPath([askNarrow, allowBroad], "src/a.ts", "edit", ROOT)).toBe(
      "ask",
    );
  });

  it("lets any matching deny beat a more specific allow", () => {
    const denyBroad = { tag: "edit", pattern: "*.ts", effect: "deny" } as const;
    const allowNarrow = {
      tag: "edit",
      pattern: "src/*.ts",
      effect: "allow",
    } as const;
    expect(checkPath([denyBroad, allowNarrow], "src/a.ts", "edit", ROOT)).toBe(
      "deny",
    );
    expect(checkPath([allowNarrow, denyBroad], "src/a.ts", "edit", ROOT)).toBe(
      "deny",
    );
  });

  it("breaks specificity ties toward the stricter effect", () => {
    const allow: Rule = { tag: "edit", pattern: "src/*.ts", effect: "allow" };
    const ask: Rule = { tag: "edit", pattern: "src/*.ts", effect: "ask" };
    const deny: Rule = { tag: "edit", pattern: "src/*.ts", effect: "deny" };

    expect(checkPath([allow, deny], "src/a.ts", "edit", ROOT)).toBe("deny");
    expect(checkPath([deny, allow], "src/a.ts", "edit", ROOT)).toBe("deny");
    expect(checkPath([allow, ask], "src/a.ts", "edit", ROOT)).toBe("ask");
    expect(checkPath([ask, allow], "src/a.ts", "edit", ROOT)).toBe("ask");
  });

  it("resolves a relative root", () => {
    const rules: Rule[] = [{ tag: "read", pattern: "*", effect: "allow" }];
    expect(
      checkPath(rules, "packages/core/src/policy.test.ts", "read", "."),
    ).toBe("allow");
  });

  it("asks when nothing matches and distinguishes no match from ask", () => {
    const rules: Rule[] = [{ tag: "edit", pattern: "docs/*", effect: "ask" }];
    expect(checkPath(rules, "src/a.ts", "edit", ROOT)).toBe("ask");
    expect(matchPath(rules, "src/a.ts", "edit", ROOT).rule).toBeUndefined();
    expect(matchPath(rules, "docs/a.md", "edit", ROOT).rule).toEqual(rules[0]);
    expect(checkPath([], "src/a.ts", "edit", ROOT)).toBe("ask");
  });

  it("ignores rules for other tags", () => {
    const rules: Rule[] = [{ tag: "read", pattern: "*", effect: "allow" }];
    expect(checkPath(rules, "src/a.ts", "edit", ROOT)).toBe("ask");
    expect(checkPath(rules, "src/a.ts", "read", ROOT)).toBe("allow");
  });

  it("denies paths that escape the root", () => {
    const rules: Rule[] = [{ tag: "edit", pattern: "*", effect: "allow" }];
    expect(checkPath(rules, "../evil.ts", "edit", ROOT)).toBe("deny");
    expect(checkPath(rules, "sub/../../evil.ts", "edit", ROOT)).toBe("deny");
    expect(checkPath(rules, "/etc/passwd", "edit", ROOT)).toBe("deny");
  });

  it("denies symlinks that point outside the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-core-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-core-outside-"));
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(outside, join(dir, "link"));
    symlinkSync(join(outside, "created.txt"), join(dir, "dangling"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "a.txt"), "x");
    symlinkSync(join(dir, "sub"), join(dir, "ok"));
    const rules: Rule[] = [{ tag: "read", pattern: "*", effect: "allow" }];
    expect(checkPath(rules, "link/secret.txt", "read", dir)).toBe("deny");
    expect(checkPath(rules, "link", "read", dir)).toBe("deny");
    expect(checkPath(rules, "dangling", "read", dir)).toBe("deny");
    expect(checkPath(rules, "link/../escaped.txt", "read", dir)).toBe("deny");
    expect(checkPath(rules, "ok/a.txt", "read", dir)).toBe("allow");
    expect(checkPath(rules, "sub/../ok/a.txt", "read", dir)).toBe("allow");
  });

  it("resolves relative and absolute paths from the project root", () => {
    const rules: Rule[] = [{ tag: "edit", pattern: "*.md", effect: "allow" }];
    expect(checkPath(rules, "notes/a.md", "edit", ROOT)).toBe("allow");
    expect(checkPath(rules, "/root/notes/a.md", "edit", ROOT)).toBe("allow");
    expect(checkPath(rules, "notes/a.ts", "edit", ROOT)).toBe("ask");
  });
});

describe("evaluate precedence", () => {
  it("denies hard safety targets before mode defaults", () => {
    expect(evaluateAs("edit", "edit", "../outside.ts")).toBe("deny");
    expect(evaluateAs("edit", "shell", "bash -c 'echo hi'")).toBe("deny");
    expect(evaluateAs("edit", "shell", "echo $(date)")).toBe("deny");
    expect(evaluateAs("edit", "shell", "echo <(date)")).toBe("deny");
  });

  it("lets explicit deny rules beat mode overrides", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "artifacts/**", effect: "deny" },
    ];
    expect(evaluateAs("plan", "edit", "artifacts/plan.md", rules)).toBe("deny");
  });

  it("lets mode overrides beat project allow rules", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "artifacts/**", effect: "allow" },
    ];
    expect(evaluateAs("plan", "edit", "artifacts/plan.md", rules)).toBe("ask");
  });

  it("resolves allow and ask rules by specificity", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "src/*", effect: "allow" },
      { tag: "edit", pattern: "src/secret.ts", effect: "ask" },
    ];
    expect(evaluateAs("edit", "edit", "src/a.ts", rules)).toBe("allow");
    expect(evaluateAs("edit", "edit", "src/secret.ts", rules)).toBe("ask");
  });

  it("favors the stricter effect on ties", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "src/*", effect: "ask" },
      { tag: "edit", pattern: "src/*", effect: "allow" },
    ];
    expect(evaluateAs("edit", "edit", "src/a.ts", rules)).toBe("ask");
  });

  it("does not depend on rule array order", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "src/*", effect: "allow" },
      { tag: "edit", pattern: "src/secret.ts", effect: "deny" },
      { tag: "edit", pattern: "src/private/*", effect: "ask" },
    ];
    const target = "src/private/a.ts";
    expect(evaluateAs("edit", "edit", target, rules)).toBe(
      evaluateAs("edit", "edit", target, [...rules].reverse()),
    );
  });

  it("falls back to the mode default when no rule matches", () => {
    expect(evaluateAs("ask", "edit", "src/a.ts")).toBe("ask");
    expect(evaluateAs("edit", "edit", "src/a.ts")).toBe("allow");
  });

  it("takes the strictest shell part", () => {
    const allowRules: Rule[] = [
      { tag: "shell", pattern: "git status", effect: "allow" },
      { tag: "shell", pattern: "git push", effect: "allow" },
    ];
    expect(
      evaluateAs("edit", "shell", "git status && git push", allowRules),
    ).toBe("allow");
    const askRules: Rule[] = [
      { tag: "shell", pattern: "git status", effect: "allow" },
      { tag: "shell", pattern: "git push", effect: "ask" },
    ];
    expect(
      evaluateAs("edit", "shell", "git status && git push", askRules),
    ).toBe("ask");
  });
});
