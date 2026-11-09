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

  it("asks for destructive commands even when broad command prefixes are allowed", () => {
    const broadAllow = rules([
      "allow shell rm",
      "allow shell find",
      "allow shell git",
      "allow shell git push",
      "allow shell timeout",
      "allow shell nohup",
      "allow shell command",
      "allow shell ls",
    ]);

    for (const command of [
      "rm -rf /",
      "rm -rf ~",
      "rm -fr ~/projects",
      "find / -delete",
      "find . -exec rm -rf {} \\;",
      "git push --force origin main",
      "git push -f origin main",
    ]) {
      expect(checkShell(command, broadAllow).decision).toBe("ask");
    }
  });

  it("does not let wrappers or separators hide a destructive command", () => {
    const broadAllow = rules([
      "allow shell rm",
      "allow shell find",
      "allow shell git",
      "allow shell ls",
      "allow shell echo",
    ]);

    for (const command of [
      "timeout 5 rm -rf /",
      "timeout -k 2 5 rm -rf ~",
      "nohup rm -rf /",
      "command rm -rf ~",
      "env FOO=1 rm -rf /",
      "env find / -delete",
      "timeout 10 find . -exec rm -rf {} \\;",
      "nohup git push --force origin main",
      "command git push -f",
      "ls; rm -rf /",
      "ls && find / -delete",
      "echo ok | git push --force",
    ]) {
      expect(checkShell(command, broadAllow).decision).toBe("ask");
    }

    // Explicit allow for the destructive command opts out
    expect(
      checkShell("rm -rf /", rules(["allow shell rm -rf /"])).decision,
    ).toBe("allow");
    expect(
      checkShell(
        "git push --force origin main",
        rules(["allow shell git push --force"]),
      ).decision,
    ).toBe("allow");
    expect(
      checkShell("find / -delete", rules(["allow shell find / -delete"]))
        .decision,
    ).toBe("allow");
  });

  it("allows safe fd merges and /dev/null redirects while denying file redirects", () => {
    const allow = rules([
      "allow shell head",
      "allow shell tail",
      "allow shell cat",
      "allow shell git status",
    ]);

    for (const command of [
      "head -n 20 README.md 2>/dev/null",
      "head -n 20 README.md 2> /dev/null",
      "tail -n 20 README.md 2>&1",
      "cat README.md 2>/dev/null | head -n 50",
      "git status 2>&1 | head -n 20",
      "git status >/dev/null 2>&1",
      "cat </dev/null",
      "LC_ALL=C head -n 10 README.md 2>/dev/null",
    ]) {
      expect(checkShell(command, allow)).toEqual({ decision: "allow" });
    }

    for (const command of [
      "head -n 20 README.md > out.txt",
      "head -n 20 README.md 2> err.txt",
      "head -n 20 README.md >/dev/null_other",
      "head -n 20 README.md 2>&1 > out.txt",
      "2>/dev/null",
    ]) {
      expect(checkShell(command, allow).decision).toBe("deny");
      expect(checkShell(command, allow).reason).toContain("redirect");
    }

    expect(checkShell("FOO=1 bash -c 'echo hi'", allow).decision).toBe("deny");
  });
});
