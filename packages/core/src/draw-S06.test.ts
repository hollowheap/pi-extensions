import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPermissions } from "./config.js";

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("S06: allow, ask and deny effects end to end", () => {
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
