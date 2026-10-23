import { describe, expect, it } from "vitest";
import { checkShell } from "./shell.js";
import type { Rule } from "./types.js";

function rules(entries: string[]): Rule[] {
  return entries.map((entry) => {
    const [effect, tag, ...rest] = entry.split(/\s+/);
    return {
      effect: effect as Rule["effect"],
      tag: tag as Rule["tag"],
      pattern: rest.join(" "),
    };
  });
}

describe("checkShell", () => {
  it("allows listed commands with and without argument prefixes", () => {
    const allow = rules(["allow shell git status", "allow shell rg"]);
    expect(checkShell("git status", allow)).toEqual({ decision: "allow" });
    expect(checkShell("git status --short", allow)).toEqual({
      decision: "allow",
    });
    expect(checkShell("rg foo", allow)).toEqual({ decision: "allow" });
    expect(checkShell("git log", allow).decision).toBe("ask");
  });

  it("matches rule tokens on boundaries, not substrings", () => {
    const statusOnly = rules(["allow shell git status"]);
    expect(checkShell("git status --short", statusOnly).decision).toBe("allow");
    expect(checkShell("git statusx", statusOnly).decision).toBe("ask");
    expect(checkShell("git status-extra", statusOnly).decision).toBe("ask");

    const gitOnly = rules(["allow shell git"]);
    expect(checkShell("git log", gitOnly).decision).toBe("allow");
    expect(checkShell("github-cli", gitOnly).decision).toBe("ask");
  });

  it("asks for unlisted commands", () => {
    expect(checkShell("sl", rules(["allow shell ls"])).decision).toBe("ask");
    expect(checkShell("sl", rules(["allow shell ls"])).reason).toContain(
      "no allow rule",
    );
  });

  it("denies dangerous names and interpreters even when allowed", () => {
    const allow = rules([
      "allow shell sh",
      "allow shell ls",
      "allow shell sudo",
      "allow shell python",
    ]);
    for (const command of [
      "sh -c 'echo hi'",
      "/bin/sh -c 'echo hi'",
      "bash -c 'echo hi'",
      "zsh -c 'echo hi'",
      "dash -c 'echo hi'",
      "fish -c 'echo hi'",
      "sudo ls",
      "ls | tee out",
      "eval x",
      "xargs ls",
      "env ls",
      "dd if=x",
      "awk '{}'",
      "perl -e 1",
      "python -c 1",
      "node -e 1",
    ]) {
      expect(checkShell(command, allow).decision).toBe("deny");
    }
  });

  it("denies redirects, command substitution, and process substitution", () => {
    const allow = rules(["allow shell echo"]);
    expect(checkShell("echo hi > out", allow).reason).toContain("redirect");
    expect(checkShell("echo hi >> out", allow).reason).toContain("redirect");
    expect(checkShell("cat < in", allow).reason).toContain("redirect");
    expect(checkShell("echo $(date)", allow).reason).toContain("substitution");
    expect(checkShell("echo `date`", allow).reason).toContain("substitution");
    expect(checkShell("echo <(date)", allow).reason).toContain(
      "process substitution",
    );
    expect(checkShell("echo >(cat)", allow).reason).toContain(
      "process substitution",
    );
    expect(checkShell("echo hi", allow)).toEqual({ decision: "allow" });
  });

  it("splits every chain operator and takes the strictest part", () => {
    const allow = rules(["allow shell git status", "allow shell ls"]);
    for (const command of [
      "git status && sl",
      "git status || sl",
      "git status; sl",
      "git status | sl",
      "git status & sl",
      "git status\nsl",
    ]) {
      expect(checkShell(command, allow).decision).toBe("ask");
    }
    for (const command of [
      "git status && ls",
      "git status || ls",
      "git status; ls",
      "git status | ls",
      "git status & ls",
      "git status\nls",
    ]) {
      expect(checkShell(command, allow)).toEqual({ decision: "allow" });
    }
  });

  it("honors explicit deny rules before allow rules", () => {
    const withDeny = rules(["allow shell ls", "deny shell ls /tmp"]);
    expect(checkShell("ls /home/u", withDeny)).toEqual({ decision: "allow" });
    expect(checkShell("ls /tmp/x", withDeny).decision).toBe("deny");
    expect(checkShell("ls /tmp/x", withDeny).reason).toContain(
      "denied by rule",
    );

    const broaderDeny = rules(["allow shell git status", "deny shell git"]);
    expect(checkShell("git status", broaderDeny).decision).toBe("deny");
  });

  it("resolves allow and ask rules by specificity", () => {
    const allowGit = rules(["allow shell git", "ask shell git push"]);
    expect(checkShell("git push origin", allowGit).decision).toBe("ask");
    expect(checkShell("git log", allowGit).decision).toBe("allow");
    const askFirst = rules(["ask shell git push", "allow shell git"]);
    expect(checkShell("git push origin", askFirst).decision).toBe("ask");
  });

  it("denies empty commands and matches names case-sensitively", () => {
    const allow = rules(["allow shell git"]);
    expect(checkShell("", allow).decision).toBe("deny");
    expect(checkShell("   ", allow).decision).toBe("deny");
    expect(checkShell("&&", allow).decision).toBe("deny");
    expect(checkShell("Git status", allow).decision).toBe("ask");
  });
});
