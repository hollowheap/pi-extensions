import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGuardTrust } from "../src/trust.js";

function agentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-core-trust-"));
  const dir = join(root, "agent");
  mkdirSync(dir);
  return dir;
}

describe("loadGuardTrust", () => {
  it("seeds the agent dir as a read/search root when guard.json is absent", () => {
    const diagnostics: string[] = [];
    const dir = agentDir();
    const trust = loadGuardTrust(dir, (m) => diagnostics.push(m));
    expect(trust.trustedRoots).toEqual([
      { path: dir, tags: ["read", "search"] },
    ]);
    expect(trust.persistentDecisions).toEqual({});
    expect(JSON.parse(readFileSync(join(dir, "guard.json"), "utf8"))).toEqual({
      trustedRoots: [{ path: dir, tags: ["read", "search"] }],
      decisions: {},
    });
    expect(diagnostics).toEqual([]);
  });

  it("loads trusted roots and persisted decisions", () => {
    const dir = agentDir();
    const outside = join(dir, "..", "outside.txt");
    writeFileSync(
      join(dir, "guard.json"),
      JSON.stringify({
        trustedRoots: [outside],
        decisions: { [outside]: "allow", "/tmp/denied": "deny", bad: 1 },
      }),
    );

    expect(loadGuardTrust(dir)).toEqual({
      trustedRoots: [outside],
      persistentDecisions: { [outside]: "allow", "/tmp/denied": "deny" },
    });
  });

  it("reports an unparseable guard file and fails closed", () => {
    const dir = agentDir();
    writeFileSync(join(dir, "guard.json"), "{");
    const diagnostics: string[] = [];
    expect(loadGuardTrust(dir, (m) => diagnostics.push(m))).toEqual({
      trustedRoots: [],
      persistentDecisions: {},
    });
    expect(diagnostics[0]).toContain("not valid JSON");
  });

  it("reports non-object JSON in guard.json and fails closed", () => {
    const dir = agentDir();
    writeFileSync(join(dir, "guard.json"), "[]");
    const diagnostics: string[] = [];
    expect(loadGuardTrust(dir, (m) => diagnostics.push(m))).toEqual({
      trustedRoots: [],
      persistentDecisions: {},
    });
    expect(diagnostics[0]).toContain("must be an object");
  });

  it("reports non-ENOENT read errors and fails closed without seeding", () => {
    const dir = agentDir();
    const guardPath = join(dir, "guard.json");
    mkdirSync(guardPath);
    const dirDiagnostics: string[] = [];
    expect(loadGuardTrust(dir, (m) => dirDiagnostics.push(m))).toEqual({
      trustedRoots: [],
      persistentDecisions: {},
    });
    expect(dirDiagnostics).toHaveLength(1);
    expect(dirDiagnostics[0]).toContain("guard.json");

    if (process.getuid?.() === 0) return;
    const permDir = agentDir();
    const permGuardPath = join(permDir, "guard.json");
    writeFileSync(permGuardPath, '{"trustedRoots":["/tmp"]}');
    chmodSync(permGuardPath, 0o000);
    try {
      const permDiagnostics: string[] = [];
      expect(loadGuardTrust(permDir, (m) => permDiagnostics.push(m))).toEqual({
        trustedRoots: [],
        persistentDecisions: {},
      });
      expect(permDiagnostics[0]).toMatch(/EACCES|permission denied/i);
    } finally {
      chmodSync(permGuardPath, 0o600);
    }
  });
});
