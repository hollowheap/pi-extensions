import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkPathTrust,
  isSubpath,
  persistGuardDecision as persistDecision,
  resolveCanonicalPath,
} from "@hollowheap/core/trust";
import { describe, expect, it } from "vitest";

describe("out-of-workspace path gating", () => {
  it("trusts workspace paths and configured roots while blocking escapes", () => {
    const workspace = mkdtempSync(
      join(tmpdir(), "workspace-path-gating-workspace-"),
    );
    const outside = mkdtempSync(
      join(tmpdir(), "workspace-path-gating-outside-"),
    );

    expect(isSubpath(workspace, join(workspace, "in.txt"), workspace)).toBe(
      true,
    );
    expect(isSubpath(workspace, "../escape", workspace)).toBe(false);

    const target = join(outside, "file.txt");
    expect(checkPathTrust(target, workspace).isTrusted).toBe(false);
    expect(checkPathTrust(target, workspace).isOutsideWorkspace).toBe(true);
    expect(checkPathTrust(target, workspace, [outside]).isTrusted).toBe(true);
  });

  it("canonicalization resolves non-existent children under an existing root", () => {
    const workspace = mkdtempSync(
      join(tmpdir(), "workspace-path-gating-workspace-"),
    );
    const nested = join(workspace, "missing", "file.txt");
    expect(resolveCanonicalPath(workspace, nested)).toBe(nested);
    expect(isSubpath(workspace, workspace, workspace)).toBe(true);
  });

  it("an invalid persistence scope is rejected", () => {
    const agentDir = mkdtempSync(
      join(tmpdir(), "workspace-path-gating-agent-"),
    );
    expect(() =>
      persistDecision(agentDir, "/any/path", "allow", "forever" as never),
    ).toThrow(/Invalid persistence scope/);
  });

  it("cached decisions override roots and deny always wins", () => {
    const workspace = mkdtempSync(
      join(tmpdir(), "workspace-path-gating-workspace-"),
    );
    const outside = mkdtempSync(
      join(tmpdir(), "workspace-path-gating-outside-"),
    );
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
