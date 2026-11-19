import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type HookPayload, runPreHook } from "../src/hooks.js";
import { clearHooksCache, loadHooks } from "../src/settings.js";

function hooksJson(command: string): string {
  return JSON.stringify({ hooks: { preTool: [{ command }] } });
}

describe("agent hooks and trusted-only project hooks", () => {
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

describe("missing config, invalid JSON and config-to-runner flow", () => {
  it("an agent directory with no hooks files yields empty lists", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hooks-draw-empty-"));
    const config = loadHooks({
      agentDir: root,
      workspaceRoot: root,
      trusted: true,
    });
    expect(config.preTool).toEqual([]);
    expect(config.postTool).toEqual([]);
    expect(config.sessionStart).toEqual([]);
  });

  it("invalid JSON in the agent hooks file is reported and ignored", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hooks-draw-bad-"));
    writeFileSync(join(root, "hooks.json"), "{bad");
    const diagnostics: string[] = [];
    const config = loadHooks({
      agentDir: root,
      workspaceRoot: root,
      trusted: true,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(config.preTool).toEqual([]);
    expect(diagnostics.join(" ")).toContain("not valid JSON");
  });

  it("a loaded hook entry blocks through the pre-hook runner", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-hooks-draw-run-"));
    writeFileSync(
      join(root, "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [
            {
              command: process.execPath,
              args: [
                "-e",
                "process.stdout.write(JSON.stringify({decision:'block',reason:'from config'}))",
              ],
              timeoutMs: 5_000,
            },
          ],
        },
      }),
    );
    const [entry] = loadHooks({
      agentDir: root,
      workspaceRoot: root,
      trusted: true,
    }).preTool;
    expect(entry.command).toBe(process.execPath);
    const payload: HookPayload = {
      event: "pre_tool",
      toolName: "bash",
      toolCallId: "c",
      input: { command: "ls" },
      cwd: root,
      mode: "manual",
    };
    await expect(runPreHook(entry, payload)).resolves.toEqual({
      block: true,
      reason: "from config",
    });
  });
});
