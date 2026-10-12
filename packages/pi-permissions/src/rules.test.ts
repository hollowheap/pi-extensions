import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Rule, check } from "./rules.js";

const ROOT = "/root";

describe("check", () => {
  it("lets the last matching rule win", () => {
    const denyLast: Rule[] = [
      { verb: "write", pattern: "*", effect: "allow" },
      { verb: "write", pattern: "src/*", effect: "deny" },
    ];
    expect(check(denyLast, "src/a.ts", "write", ROOT)).toBe("deny");
    const allowLast: Rule[] = [
      { verb: "write", pattern: "*", effect: "deny" },
      { verb: "write", pattern: "src/*", effect: "allow" },
    ];
    expect(check(allowLast, "src/a.ts", "write", ROOT)).toBe("allow");
  });

  it("denies ties of equal specificity even when allow is last", () => {
    const rules: Rule[] = [
      { verb: "write", pattern: "src/*.ts", effect: "deny" },
      { verb: "write", pattern: "src/*.ts", effect: "allow" },
    ];
    expect(check(rules, "src/a.ts", "write", ROOT)).toBe("deny");
  });

  it("denies ties regardless of order", () => {
    const rules: Rule[] = [
      { verb: "write", pattern: "src/*.ts", effect: "allow" },
      { verb: "write", pattern: "src/*.ts", effect: "deny" },
    ];
    expect(check(rules, "src/a.ts", "write", ROOT)).toBe("deny");
  });

  it("allows a later allow at different specificity", () => {
    const rules: Rule[] = [
      { verb: "write", pattern: "*.ts", effect: "deny" },
      { verb: "write", pattern: "src/*.ts", effect: "allow" },
    ];
    expect(check(rules, "src/a.ts", "write", ROOT)).toBe("allow");
  });

  it("denies when nothing matches", () => {
    const rules: Rule[] = [
      { verb: "write", pattern: "docs/*", effect: "allow" },
    ];
    expect(check(rules, "src/a.ts", "write", ROOT)).toBe("deny");
    expect(check([], "src/a.ts", "write", ROOT)).toBe("deny");
  });

  it("ignores rules for the other verb", () => {
    const rules: Rule[] = [{ verb: "read", pattern: "*", effect: "allow" }];
    expect(check(rules, "src/a.ts", "write", ROOT)).toBe("deny");
    expect(check(rules, "src/a.ts", "read", ROOT)).toBe("allow");
  });

  it("denies paths that escape the root", () => {
    const rules: Rule[] = [{ verb: "write", pattern: "*", effect: "allow" }];
    expect(check(rules, "../evil.ts", "write", ROOT)).toBe("deny");
    expect(check(rules, "sub/../../evil.ts", "write", ROOT)).toBe("deny");
    expect(check(rules, "/etc/passwd", "write", ROOT)).toBe("deny");
  });

  it("denies symlinks that point outside the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-symlink-"));
    const outside = mkdtempSync(join(tmpdir(), "pi-outside-"));
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(outside, join(dir, "link"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "a.txt"), "x");
    symlinkSync(join(dir, "sub"), join(dir, "ok"));
    const rules: Rule[] = [{ verb: "read", pattern: "*", effect: "allow" }];
    expect(check(rules, "link/secret.txt", "read", dir)).toBe("deny");
    expect(check(rules, "link", "read", dir)).toBe("deny");
    expect(check(rules, "ok/a.txt", "read", dir)).toBe("allow");
  });

  it("resolves relative and absolute paths from the project root", () => {
    const rules: Rule[] = [{ verb: "write", pattern: "*.md", effect: "allow" }];
    expect(check(rules, "notes/a.md", "write", ROOT)).toBe("allow");
    expect(check(rules, "/root/notes/a.md", "write", ROOT)).toBe("allow");
    expect(check(rules, "notes/a.ts", "write", ROOT)).toBe("deny");
  });

  it("blocks src writes but allows spec and plan writes under the example rules", () => {
    const example: Rule[] = [
      { verb: "write", pattern: "*", effect: "deny" },
      { verb: "write", pattern: "artifacts/specs/*.md", effect: "allow" },
      { verb: "write", pattern: "artifacts/plan/*.md", effect: "allow" },
    ];
    expect(check(example, "src/x.ts", "write", ROOT)).toBe("deny");
    expect(check(example, "artifacts/specs/a.md", "write", ROOT)).toBe("allow");
    expect(check(example, "artifacts/plan/a.md", "write", ROOT)).toBe("allow");
    expect(check(example, "artifacts/specs/a.ts", "write", ROOT)).toBe("deny");
  });
});
