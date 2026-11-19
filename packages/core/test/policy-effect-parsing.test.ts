import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { loadPermissions } from "../src/config.js";
import { evaluate, registerMode } from "../src/modes.js";
import { dropSession, setMode } from "../src/state.js";

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("allow, ask and deny effects end to end", () => {
  it("loads all three effects from object and string rules", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-core-draw-s06-"));
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        rules: [
          { tag: "edit", pattern: "src/**", effect: "ask" },
          "deny shell rm -rf",
          { tag: "read", pattern: "*", effect: "allow" },
        ],
      }),
    );

    expect(
      loadPermissions({ agentDir, workspaceRoot: root, trusted: false }),
    ).toEqual([
      { tag: "edit", pattern: "src/**", effect: "ask" },
      { tag: "shell", pattern: "rm -rf", effect: "deny" },
      { tag: "read", pattern: "*", effect: "allow" },
    ]);
  });
});

describe("effect parsing boundary, failure fallback and evaluator consumer", () => {
  it("an explicit rule list of malformed entries yields no effects", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-core-draw-s06-"));
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({ rules: ["nonsense", 42] }),
    );
    expect(
      loadPermissions({
        agentDir,
        workspaceRoot: root,
        trusted: false,
        onDiagnostic: (message) => diagnostics.push(message),
      }),
    ).toEqual([]);
    expect(diagnostics.join(" ")).toContain("ignoring rule");
  });

  it("invalid JSON falls back to ask rules for every category", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-core-draw-s06-"));
    const agentDir = join(root, "agent");
    const diagnostics: string[] = [];
    write(join(agentDir, "permissions.json"), "{not json");
    const rules = loadPermissions({
      agentDir,
      workspaceRoot: root,
      trusted: false,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(diagnostics.join(" ")).toContain("not valid JSON");
    expect(rules).toHaveLength(5);
    expect(rules.every((rule) => rule.effect === "ask")).toBe(true);
  });

  it("loaded effects drive evaluation through the mode layer", () => {
    for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);
    const root = mkdtempSync(join(tmpdir(), "pi-core-draw-s06-"));
    const agentDir = join(root, "agent");
    write(
      join(agentDir, "permissions.json"),
      JSON.stringify({
        rules: ["allow edit src/**", "ask shell npm", "deny edit secrets/**"],
      }),
    );
    const rules = loadPermissions({
      agentDir,
      workspaceRoot: root,
      trusted: false,
    });
    const owner = {};
    setMode(owner, "manual");
    expect(
      evaluate({ owner, cwd: root, tag: "edit", target: "src/a.ts", rules }),
    ).toBe("allow");
    expect(
      evaluate({
        owner,
        cwd: root,
        tag: "edit",
        target: "secrets/key.ts",
        rules,
      }),
    ).toBe("deny");
    expect(
      evaluate({ owner, cwd: root, tag: "shell", target: "npm test", rules }),
    ).toBe("ask");
    dropSession(owner);
  });
});
