import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadHooks } from "./config.js";

function agentDir(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-hooks-"));
  writeFileSync(join(dir, "hooks.json"), contents);
  return dir;
}

describe("loadHooks", () => {
  it("parses pre-tool and post-tool entries", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [{ matcher: "Bash", command: "check", args: ["--strict"] }],
          postTool: [{ command: "npm", args: ["test"] }],
        },
      }),
    );
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
    });
    expect(config.preTool).toEqual([
      {
        matcher: "Bash",
        command: "check",
        args: ["--strict"],
        timeoutMs: 10_000,
      },
    ]);
    expect(config.postTool).toEqual([
      { matcher: "", command: "npm", args: ["test"], timeoutMs: 10_000 },
    ]);
  });

  it("merges the project overlay after the agent-dir hooks when trusted", () => {
    const dir = agentDir(
      JSON.stringify({ hooks: { preTool: [{ command: "agent" }] } }),
    );
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "hooks.json"),
      JSON.stringify({ hooks: { preTool: [{ command: "project" }] } }),
    );
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
    });
    expect(config.preTool.map((hook) => hook.command)).toEqual([
      "agent",
      "project",
    ]);
  });

  it("ignores the project overlay when the project is not trusted", () => {
    const dir = agentDir(
      JSON.stringify({ hooks: { preTool: [{ command: "agent" }] } }),
    );
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "hooks.json"),
      JSON.stringify({ hooks: { preTool: [{ command: "project" }] } }),
    );
    const diagnostics: string[] = [];
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: false,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(config.preTool.map((hook) => hook.command)).toEqual(["agent"]);
    expect(diagnostics).toEqual([
      "ignoring .pi/hooks.json: project is not trusted",
    ]);
  });

  it("drops a malformed file and diagnoses it", () => {
    const dir = agentDir("{not json");
    const diagnostics: string[] = [];
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(config.preTool).toEqual([]);
    expect(diagnostics[0]).toContain("not valid JSON");
  });

  it("drops only the offending entry", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [{ command: "good" }, { args: ["no-command"] }],
          postTool: "not an array",
          unknownKind: [],
        },
      }),
    );
    const diagnostics: string[] = [];
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(config.preTool.map((hook) => hook.command)).toEqual(["good"]);
    expect(config.postTool).toEqual([]);
    expect(diagnostics).toContain(
      'ignoring preTool[1]: "command" must be a non-empty string',
    );
    expect(diagnostics).toContain("ignoring postTool: must be an array");
    expect(diagnostics).toContain("ignoring unknown hook kind: unknownKind");
  });

  it("reports a diagnostic once per change", () => {
    const dir = agentDir(
      JSON.stringify({ hooks: { preTool: [{ command: "good" }, {}] } }),
    );
    const diagnostics: string[] = [];
    const options = {
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
      onDiagnostic: (message: string) => diagnostics.push(message),
    };
    loadHooks(options);
    loadHooks(options);
    expect(diagnostics).toHaveLength(1);
  });
});
