import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPathTrust,
  isSubpath,
  persistDecision,
  resolveCanonicalPath,
} from "./rules.js";

describe("S109 out-of-workspace path gating", () => {
  it("trusts workspace paths and configured roots while blocking escapes", () => {
    const workspace = mkdtempSync(join(tmpdir(), "s109-workspace-"));
    const outside = mkdtempSync(join(tmpdir(), "s109-outside-"));

    expect(isSubpath(workspace, join(workspace, "in.txt"), workspace)).toBe(
      true,
    );
    expect(isSubpath(workspace, "../escape", workspace)).toBe(false);

    const target = join(outside, "file.txt");
    expect(checkPathTrust(target, workspace).isTrusted).toBe(false);
    expect(checkPathTrust(target, workspace).isOutsideWorkspace).toBe(true);
    expect(checkPathTrust(target, workspace, [outside]).isTrusted).toBe(true);
  });

  it("S109 C02: canonicalization resolves non-existent children under an existing root", () => {
    const workspace = mkdtempSync(join(tmpdir(), "s109-workspace-"));
    const nested = join(workspace, "missing", "file.txt");
    expect(resolveCanonicalPath(workspace, nested)).toBe(nested);
    expect(isSubpath(workspace, workspace, workspace)).toBe(true);
  });

  it("S109 C03: an invalid persistence scope is rejected", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "s109-agent-"));
    expect(() =>
      persistDecision(agentDir, "/any/path", "allow", "forever" as never),
    ).toThrow(/Invalid persistence scope/);
  });

  it("S109 C04: cached decisions override roots and deny always wins", () => {
    const workspace = mkdtempSync(join(tmpdir(), "s109-workspace-"));
    const outside = mkdtempSync(join(tmpdir(), "s109-outside-"));
    const target = join(outside, "file.txt");

    const allowed = checkPathTrust(
      target,
      workspace,
      [],
      new Map([[target, "allow" as const]]),
    );
    expect(allowed.isTrusted).toBe(true);
    expect(allowed.cachedDecision).toBe("allow");

    const denied = checkPathTrust(
      target,
      workspace,
      [outside],
      new Map([[target, "deny" as const]]),
    );
    expect(denied.isTrusted).toBe(false);
    expect(denied.cachedDecision).toBe("deny");
  });
});
