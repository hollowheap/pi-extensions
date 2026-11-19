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
import {
  clearHooksCache,
  loadHooks,
  saveHooksSettings,
} from "../src/settings.js";

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

  it("reports cached diagnostics to a different consumer", () => {
    const dir = agentDir(
      JSON.stringify({ hooks: { preTool: [{ command: "good" }, {}] } }),
    );
    const first: string[] = [];
    const second: string[] = [];
    const base = { agentDir: dir, workspaceRoot: dir, trusted: true };
    loadHooks({
      ...base,
      onDiagnostic: (message) => first.push(message),
    });
    loadHooks({
      ...base,
      onDiagnostic: (message) => second.push(message),
    });

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("maps 'if' property to condition", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [{ command: "check", if: "tool == 'bash'" }],
        },
      }),
    );
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
    });
    expect(config.preTool[0]?.condition).toBe("tool == 'bash'");
  });

  it("drops entries with invalid conditions and keeps valid siblings", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [
            { command: "bad-syntax", condition: "nonsense" },
            { command: "bad-regex", condition: "matches(tool, '[')" },
            { command: "good", condition: "tool == 'bash'" },
          ],
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
    expect(
      diagnostics.filter((message) => message.includes("condition")),
    ).toHaveLength(2);
  });

  it("resolves relative command paths against declaring config directory while leaving bare commands intact", () => {
    const dir = agentDir(
      JSON.stringify({
        hooks: {
          preTool: [
            { command: "./scripts/guard.sh" },
            { command: "true" },
            { command: "node" },
          ],
        },
      }),
    );
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "hooks.json"),
      JSON.stringify({
        hooks: {
          preTool: [
            { command: "./scripts/project-guard.sh" },
            { command: "echo" },
          ],
        },
      }),
    );

    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
    });

    expect(config.preTool.map((h) => h.command)).toEqual([
      join(dir, "scripts", "guard.sh"),
      "true",
      "node",
      join(dir, ".pi", "scripts", "project-guard.sh"),
      "echo",
    ]);
  });

  it("parses top-level and per-hook sandbox config and saves sandbox settings", () => {
    clearHooksCache();
    const dir = agentDir(
      JSON.stringify({
        sandbox: { enabled: true, offline: true, maskPaths: ["/secret"] },
        hooks: {
          preTool: [
            { command: "inherited" },
            { command: "opt-out", sandbox: false },
          ],
        },
      }),
    );
    const config = loadHooks({
      agentDir: dir,
      workspaceRoot: dir,
      trusted: true,
    });
    expect(config.sandbox).toEqual({
      enabled: true,
      offline: true,
      maskPaths: ["/secret"],
    });
    expect(config.preTool[0]?.sandbox).toEqual({
      enabled: true,
      offline: true,
      maskPaths: ["/secret"],
    });
    expect(config.preTool[1]?.sandbox).toBe(false);

    saveHooksSettings(dir, { sandboxEnabled: false, sandboxOffline: false });
    const saved = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8")) as {
      sandbox?: Record<string, unknown>;
      hooks?: Record<string, unknown>;
    };
    expect(saved.sandbox).toEqual({
      enabled: false,
      offline: false,
      maskPaths: ["/secret"],
    });
    expect(saved.hooks).toBeDefined();
  });

  it("surfaces OS permission errors on unreadable or unwritable hooks.json", () => {
    if (process.getuid?.() === 0) return;
    clearHooksCache();
    const dir = agentDir(JSON.stringify({ hooks: {} }));
    const path = join(dir, "hooks.json");
    chmodSync(path, 0o000);
    try {
      const diagnostics: string[] = [];
      loadHooks({
        agentDir: dir,
        workspaceRoot: dir,
        trusted: true,
        onDiagnostic: (msg) => diagnostics.push(msg),
      });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain("OS permission denied");
      expect(() => saveHooksSettings(dir, { sandboxEnabled: true })).toThrow(
        /OS permission denied/,
      );
    } finally {
      chmodSync(path, 0o600);
    }
  });
});
