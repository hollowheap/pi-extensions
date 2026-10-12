import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Rule, check } from "./rules.js";

const ROOT = "/root";

describe("check", () => {
  it("lets the last matching rule win", () => {
    const denyLast: Rule[] = [
      { tag: "edit", pattern: "*", effect: "allow" },
      { tag: "edit", pattern: "src/*", effect: "deny" },
    ];
    expect(check(denyLast, "src/a.ts", "edit", ROOT)).toBe("deny");
    const allowLast: Rule[] = [
      { tag: "edit", pattern: "*", effect: "deny" },
      { tag: "edit", pattern: "src/*", effect: "allow" },
    ];
    expect(check(allowLast, "src/a.ts", "edit", ROOT)).toBe("allow");
  });

  it("denies ties of equal specificity even when allow is last", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "src/*.ts", effect: "deny" },
      { tag: "edit", pattern: "src/*.ts", effect: "allow" },
    ];
    expect(check(rules, "src/a.ts", "edit", ROOT)).toBe("deny");
  });

  it("denies ties regardless of order", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "src/*.ts", effect: "allow" },
      { tag: "edit", pattern: "src/*.ts", effect: "deny" },
    ];
    expect(check(rules, "src/a.ts", "edit", ROOT)).toBe("deny");
  });

  it("allows a later allow at different specificity", () => {
    const rules: Rule[] = [
      { tag: "edit", pattern: "*.ts", effect: "deny" },
      { tag: "edit", pattern: "src/*.ts", effect: "allow" },
    ];
    expect(check(rules, "src/a.ts", "edit", ROOT)).toBe("allow");
  });

  it("asks when nothing matches", () => {
    const rules: Rule[] = [{ tag: "edit", pattern: "docs/*", effect: "allow" }];
    expect(check(rules, "src/a.ts", "edit", ROOT)).toBe("ask");
    expect(check([], "src/a.ts", "edit", ROOT)).toBe("ask");
  });

  it("ignores rules for the other tag", () => {
    const rules: Rule[] = [{ tag: "read", pattern: "*", effect: "allow" }];
    expect(check(rules, "src/a.ts", "edit", ROOT)).toBe("ask");
    expect(check(rules, "src/a.ts", "read", ROOT)).toBe("allow");
  });

  it("denies paths that escape the root", () => {
    const rules: Rule[] = [{ tag: "edit", pattern: "*", effect: "allow" }];
    expect(check(rules, "../evil.ts", "edit", ROOT)).toBe("deny");
    expect(check(rules, "sub/../../evil.ts", "edit", ROOT)).toBe("deny");
    expect(check(rules, "/etc/passwd", "edit", ROOT)).toBe("deny");
  });

  it("denies symlinks that point outside the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-outside-"));
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(outside, join(dir, "link"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "a.txt"), "x");
    symlinkSync(join(dir, "sub"), join(dir, "ok"));
    const rules: Rule[] = [{ tag: "read", pattern: "*", effect: "allow" }];
    expect(check(rules, "link/secret.txt", "read", dir)).toBe("deny");
    expect(check(rules, "link", "read", dir)).toBe("deny");
    expect(check(rules, "ok/a.txt", "read", dir)).toBe("allow");
  });

  it("resolves relative and absolute paths from the project root", () => {
    const rules: Rule[] = [{ tag: "edit", pattern: "*.md", effect: "allow" }];
    expect(check(rules, "notes/a.md", "edit", ROOT)).toBe("allow");
    expect(check(rules, "/root/notes/a.md", "edit", ROOT)).toBe("allow");
    expect(check(rules, "notes/a.ts", "edit", ROOT)).toBe("ask");
  });

  it("blocks src writes but allows spec and plan writes under the example rules", () => {
    const example: Rule[] = [
      { tag: "edit", pattern: "*", effect: "deny" },
      { tag: "edit", pattern: "artifacts/specs/*.md", effect: "allow" },
      { tag: "edit", pattern: "artifacts/plan/*.md", effect: "allow" },
    ];
    expect(check(example, "src/x.ts", "edit", ROOT)).toBe("deny");
    expect(check(example, "artifacts/specs/a.md", "edit", ROOT)).toBe("allow");
    expect(check(example, "artifacts/plan/a.md", "edit", ROOT)).toBe("allow");
    expect(check(example, "artifacts/specs/a.ts", "edit", ROOT)).toBe("deny");
  });
});
