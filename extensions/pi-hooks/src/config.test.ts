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
  it("parses pre-tool, post-tool, and session-start entries", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [{ matcher: "Bash", command: "check", args: ["--strict"] }],
          postTool: [{ command: "npm", args: ["test"] }],
          sessionStart: [
            { matcher: "ignored", command: "startup", args: ["--init"] },
          ],
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
    expect(config.sessionStart).toEqual([
      {
        matcher: "ignored",
        command: "startup",
        args: ["--init"],
        timeoutMs: 10_000,
      },
    ]);
  });

  it("merges the project overlay after the agent-dir hooks when trusted", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [{ command: "agent" }],
          sessionStart: [{ command: "agent-start" }],
        },
      }),
    );
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [{ command: "project" }],
          sessionStart: [{ command: "project-start" }],
        },
      }),
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
    expect(config.sessionStart.map((hook) => hook.command)).toEqual([
      "agent-start",
      "project-start",
    ]);
  });

  it("ignores the project overlay when the project is not trusted", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [{ command: "agent" }],
          sessionStart: [{ command: "agent-start" }],
        },
      }),
    );
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [{ command: "project" }],
          sessionStart: [{ command: "project-start" }],
        },
      }),
    );
    const diagnostics: string[] = [];
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: false,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    expect(config.preTool.map((hook) => hook.command)).toEqual(["agent"]);
    expect(config.sessionStart.map((hook) => hook.command)).toEqual([
      "agent-start",
    ]);
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
          sessionStart: [{ command: "good-start" }, { command: 42 }],
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
    expect(config.sessionStart.map((hook) => hook.command)).toEqual([
      "good-start",
    ]);
    expect(diagnostics).toContain(
      'ignoring preTool[1]: "command" must be a non-empty string',
    );
    expect(diagnostics).toContain(
      'ignoring sessionStart[1]: "command" must be a non-empty string',
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
