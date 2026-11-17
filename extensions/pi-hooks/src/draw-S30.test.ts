import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clearHooksCache, loadHooks } from "./config.js";

function hooksJson(command: string): string {
  return JSON.stringify({ hooks: { preTool: [{ command }] } });
}

describe("S30: agent hooks and trusted-only project hooks", () => {
  beforeEach(() => clearHooksCache());

  it("loads <agentDir>/hooks.json and overlays <project>/.pi/hooks.json only when trusted", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hooks-draw-"));
    writeFileSync(join(root, "hooks.json"), hooksJson("agent-cmd"));
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(join(root, ".pi", "hooks.json"), hooksJson("project-cmd"));

    const trusted = loadHooks({
      agentDir: root,
      workspaceRoot: root,
      trusted: true,
    });
    expect(trusted.preTool.map((entry) => entry.command)).toEqual([
      "agent-cmd",
      "project-cmd",
    ]);

    clearHooksCache();
    const untrusted = loadHooks({
      agentDir: root,
      workspaceRoot: root,
      trusted: false,
    });
    expect(untrusted.preTool.map((entry) => entry.command)).toEqual([
      "agent-cmd",
    ]);
  });
});
