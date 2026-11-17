import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPathTrust, isSubpath } from "./rules.js";

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
});
