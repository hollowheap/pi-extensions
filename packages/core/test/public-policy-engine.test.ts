import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import {
  checkPath,
  checkShell,
  evaluate,
  loadPermissions,
} from "../src/index.js";
import { registerMode } from "../src/modes.js";
import { dropSession, setMode } from "../src/state.js";
import type { Rule } from "../src/types.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("core is the single public policy engine", () => {
  it("exports and applies evaluate, loadPermissions, checkPath and checkShell", () => {
    expect(typeof evaluate).toBe("function");
    expect(typeof loadPermissions).toBe("function");
    expect(typeof checkPath).toBe("function");
    expect(typeof checkShell).toBe("function");

    expect(
      checkPath(
        [{ tag: "edit", pattern: "src/**", effect: "allow" }],
        "src/a.ts",
        "edit",
        "/work",
      ),
    ).toBe("allow");
    expect(checkShell("echo $(date)", []).decision).toBe("deny");

    const owner = {};
    setMode(owner, "edit");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    dropSession(owner);
  });
});

describe("policy engine boundary, refusal and consumer cases", () => {
  it("empty rule sets and empty commands fall back to safe verdicts", () => {
    expect(checkPath([], "src/a.ts", "edit", "/work")).toBe("ask");
    expect(checkShell("", [])).toEqual({
      decision: "deny",
      reason: "empty command",
    });
  });

  it("an explicit shell deny and an explicit path deny are refused", () => {
    const denyShell: Rule[] = [{ tag: "shell", pattern: "rm", effect: "deny" }];
    expect(checkShell("rm -rf /", denyShell)).toEqual({
      decision: "deny",
      reason: 'denied by rule for "rm"',
    });
    const denyEdit: Rule[] = [
      { tag: "edit", pattern: "src/**", effect: "deny" },
    ];
    expect(checkPath(denyEdit, "src/a.ts", "edit", "/work")).toBe("deny");
  });

  it("rules loaded from permissions.json drive the path and shell checkers", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-core-draw-s01-"));
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "permissions.json"),
      JSON.stringify({ rules: ["allow edit src/**", "deny shell rm"] }),
    );
    const rules = loadPermissions({
      agentDir,
      workspaceRoot: root,
      trusted: false,
    });
    expect(checkPath(rules, "src/a.ts", "edit", root)).toBe("allow");
    expect(checkShell("rm -rf /", rules).decision).toBe("deny");
  });
});
