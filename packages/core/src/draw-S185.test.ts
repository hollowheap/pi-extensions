import { describe, expect, it } from "vitest";
import { checkShell } from "./shell.js";

describe("S185 destructive shell safety", () => {
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
});
