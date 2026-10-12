import { describe, expect, it } from "vitest";
import { checkBash } from "./bash.js";
import type { Rule } from "./rules.js";

function rules(patterns: string[]): Rule[] {
  return patterns.map((entry) => {
    const [effect, tag, ...rest] = entry.split(" ");
    return {
      effect: effect as "allow" | "deny",
      tag: tag as Rule["tag"],
      pattern: rest.join(" "),
    };
  });
}

describe("checkBash", () => {
  it("allows listed commands with and without argument prefixes", () => {
    const allow = rules(["allow bash git status", "allow bash rg"]);
    expect(checkBash("git status", allow)).toEqual({ allowed: true });
    expect(checkBash("git status --short", allow)).toEqual({ allowed: true });
    expect(checkBash("rg foo", allow)).toEqual({ allowed: true });
    expect(checkBash("git log", allow).allowed).toBe(false);
  });

  it("denies unlisted commands", () => {
    expect(checkBash("sl", rules(["allow bash ls"])).allowed).toBe(false);
    expect(checkBash("sl", rules(["allow bash ls"])).reason).toContain(
      "no allow rule",
    );
  });

  it("denies dangerous names even when allowed", () => {
    const allow = rules(["allow bash sh", "allow bash ls", "allow bash sudo"]);
    expect(checkBash("sh -c 'echo hi'", allow).allowed).toBe(false);
    expect(checkBash("/bin/sh -c 'echo hi'", allow).allowed).toBe(false);
    expect(checkBash("sudo ls", allow).allowed).toBe(false);
    expect(checkBash("ls | tee out", allow).allowed).toBe(false);
    expect(checkBash("eval x", allow).reason).toContain("dangerous");
  });

  it("denies redirects and command substitution", () => {
    const allow = rules(["allow bash echo"]);
    expect(checkBash("echo hi > out", allow).reason).toContain("redirect");
    expect(checkBash("echo hi >> out", allow).reason).toContain("redirect");
    expect(checkBash("echo $(date)", allow).reason).toContain("substitution");
    expect(checkBash("echo `date`", allow).reason).toContain("substitution");
    expect(checkBash("echo hi", allow)).toEqual({ allowed: true });
  });

  it("denies chains with one bad part", () => {
    const allow = rules(["allow bash git status", "allow bash ls"]);
    expect(checkBash("git status && sl", allow).allowed).toBe(false);
    expect(checkBash("git status; git log", allow).allowed).toBe(false);
    expect(checkBash("git status || sl", allow).allowed).toBe(false);
    expect(checkBash("git status | sl", allow).allowed).toBe(false);
    expect(checkBash("git status && ls", allow)).toEqual({ allowed: true });
  });

  it("honors explicit deny rules", () => {
    const withDeny = rules(["allow bash ls", "deny bash ls /tmp"]);
    expect(checkBash("ls /home/u", withDeny)).toEqual({ allowed: true });
    expect(checkBash("ls /tmp/x", withDeny).reason).toContain("denied by rule");
  });

  it("denies empty commands and matches names exactly", () => {
    const allow = rules(["allow bash git"]);
    expect(checkBash("", allow).allowed).toBe(false);
    expect(checkBash("   ", allow).allowed).toBe(false);
    expect(checkBash("Git status", allow).allowed).toBe(false);
  });
});
