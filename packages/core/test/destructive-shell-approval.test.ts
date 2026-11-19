import { describe, expect, it } from "vitest";
import { checkShell } from "../src/shell.js";

describe("destructive shell safety", () => {
  it("asks for a destructive command even when broad shell allows exist", () => {
    const broadAllow = [
      { tag: "shell", pattern: "rm", effect: "allow" },
      { tag: "shell", pattern: "git", effect: "allow" },
    ] as const;

    expect(checkShell("rm -rf /", broadAllow).decision).toBe("ask");
    expect(checkShell("timeout 5 rm -rf ~", broadAllow).decision).toBe("ask");
    expect(
      checkShell("git push --force origin main", broadAllow).decision,
    ).toBe("ask");
  });

  it("an empty command is denied with an explicit reason", () => {
    expect(checkShell("   ", [])).toEqual({
      decision: "deny",
      reason: "empty command",
    });
  });

  it("an explicit shell deny rule refuses a command", () => {
    const deny = { tag: "shell", pattern: "echo", effect: "deny" } as const;
    const verdict = checkShell("echo hello", [deny]);
    expect(verdict.decision).toBe("deny");
    expect(verdict.reason).toContain("denied by rule");
  });

  it("a destructive command after a separator still asks", () => {
    const broadAllow = [
      { tag: "shell", pattern: "echo", effect: "allow" },
      { tag: "shell", pattern: "rm", effect: "allow" },
    ] as const;
    expect(checkShell("echo ok; rm -rf /", broadAllow).decision).toBe("ask");
    expect(checkShell("echo ok && rm -rf /", broadAllow).decision).toBe("ask");
  });
});
